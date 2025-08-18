import React, { useState, useEffect, useContext, useCallback, useRef, useMemo } from 'react';
import {
    StyleSheet, Text, View, TouchableOpacity, ScrollView,
    ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform, Image
} from 'react-native';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { updateBookState, addBookmark, removeBookmark, saveAnnotation, removeAnnotation, loadLibrary } from '../utils/libraryManager';

import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import { captureRef } from 'react-native-view-shot';

let Pdf;
let pdfAvailable = false;
try {
    Pdf = require('react-native-pdf').default;
    pdfAvailable = true;
} catch (error) {
    console.warn('react-native-pdf não está disponível:', error);
    pdfAvailable = false;
}

const HighlightedText = ({ text, currentWordIndex, colors }) => {
    const words = text ? text.split(/\s+/) : [];
    return (
        <ScrollView contentContainerStyle={styles.textContainerScrollView}>
            <Text style={[styles.textContainer, { color: colors.text }]}>
                {words.map((word, index) => (
                    <Text
                        key={index}
                        style={index === currentWordIndex ? [styles.highlightedWord, { backgroundColor: colors.primary, color: colors.card }] : null}
                    >
                        {word}{' '}
                    </Text>
                ))}
            </Text>
        </ScrollView>
    );
};

const PdfFallback = ({ colors }) => (
    <View style={[styles.centered, { padding: 20 }]}>
        <Ionicons name="document-text-outline" size={80} color={colors.subtext} />
        <Text style={[styles.fallbackText, { color: colors.text }]}>
            Visualização em PDF não disponível
        </Text>
        <Text style={[styles.fallbackSubtext, { color: colors.subtext }]}>
            O módulo react-native-pdf não está configurado corretamente
        </Text>
    </View>
);

// Lupa via snapshot do container do PDF (sem segunda instância do Pdf)
const LUPA_SIZE = 200;
const LUPA_VERTICAL_OFFSET = -LUPA_SIZE * 1.25;
const MAGNIFIER_ZOOM = 2.0;

// opcional: debug e microajustes finos (se restar 1–2 dp de offset visual por conta de PixelRatio/border)
const DEBUG_LUPA = false;
const SHIFT_X = 0;
const SHIFT_Y = 0;

const Magnifier = ({ snapshotUri, isVisible, position, pdfLayout, pdfScale, pageData, currentWordIndex }) => {
    const { colors } = useContext(ThemeContext);

    // Container da lente: sem scale animado (para não deslocar o centro visual)
    const magnifierStyle = useAnimatedStyle(() => {
        return {
            opacity: isVisible.value,
            top: position.touchY.value + LUPA_VERTICAL_OFFSET,
            left: position.touchX.value - LUPA_SIZE / 2,
        };
    });

    // Conteúdo da lente:
    // - Tamanho já ampliado: Wz = W * Z, Hz = H * Z
    // - Apenas translate para colocar o ponto (sx,sy) no centro da lente
    const contentStyle = useAnimatedStyle(() => {
        const Z = MAGNIFIER_ZOOM;
        const W = pdfLayout.width * pdfScale;
        const H = pdfLayout.height * pdfScale;

        // ponto alvo no snapshot (em dp)
        const sx = position.pdfX.value * pdfScale;
        const sy = position.pdfY.value * pdfScale;

        // centraliza (sx,sy) no centro da lente
        const tx = (LUPA_SIZE / 2) - (sx * Z) + SHIFT_X;
        const ty = (LUPA_SIZE / 2) - (sy * Z) + SHIFT_Y;

        return {
            width: W * Z,
            height: H * Z,
            transform: [{ translateX: tx }, { translateY: ty }],
        };
    });

    const wordData =
        pageData?.palavras && currentWordIndex >= 0 && currentWordIndex < pageData.palavras.length
            ? pageData.palavras[currentWordIndex]
            : null;

    if (!snapshotUri || !pdfLayout.width || !pdfLayout.height) return null;

    return (
        <Animated.View
            style={[
                styles.lupaContainer,
                { borderColor: colors.primary, width: LUPA_SIZE, height: LUPA_SIZE, borderRadius: LUPA_SIZE / 2 },
                magnifierStyle
            ]}
            pointerEvents="none"
        >
            <Animated.View style={[{ overflow: 'hidden' }, contentStyle]}>
                <Image
                    source={{ uri: snapshotUri }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="stretch"
                />

                {/* Se quiser manter o highlight dentro da lente, ele precisa considerar Z */}
                {wordData?.coords && (
                    <View
                        style={[
                            styles.wordHighlight,
                            {
                                position: 'absolute',
                                top: wordData.coords.y0 * pdfScale * MAGNIFIER_ZOOM,
                                left: wordData.coords.x0 * pdfScale * MAGNIFIER_ZOOM,
                                width: (wordData.coords.x1 - wordData.coords.x0) * pdfScale * MAGNIFIER_ZOOM,
                                height: (wordData.coords.y1 - wordData.coords.y0) * pdfScale * MAGNIFIER_ZOOM,
                                backgroundColor: colors.primary,
                            }
                        ]}
                    />
                )}

                {DEBUG_LUPA && (
                    <View
                        pointerEvents="none"
                        style={{
                            position: 'absolute',
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: 'red',
                            left: (LUPA_SIZE / 2) - 4,
                            top: (LUPA_SIZE / 2) - 4,
                        }}
                    />
                )}
            </Animated.View>
        </Animated.View>
    );
};

export default function PlayerScreen({ route }) {
    if (!route.params || !route.params.bookInfo) {
        return (
            <View style={styles.centered}>
                <Text style={{ fontSize: 18, textAlign: 'center', padding: 20 }}>
                    A aguardar informações do livro...
                </Text>
                <ActivityIndicator size="large" />
            </View>
        );
    }

    const { colors } = useContext(ThemeContext);
    const navigation = useNavigation();
    const { bookInfo } = route.params;

    const [currentPageIndex, setCurrentPageIndex] = useState(bookInfo.lastPosition || 0);
    const [pageData, setPageData] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentWordIndex, setCurrentWordIndex] = useState(-1);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [activeVoice, setActiveVoice] = useState(null);
    const [bookmarks, setBookmarks] = useState(bookInfo.bookmarks || []);
    const [annotations, setAnnotations] = useState(bookInfo.annotations || {});
    const [bookmarkModalVisible, setBookmarkModalVisible] = useState(false);
    const [annotationModalVisible, setAnnotationModalVisible] = useState(false);
    const [currentAnnotation, setCurrentAnnotation] = useState('');
    const [pdfLayout, setPdfLayout] = useState({ width: 1, height: 1 });
    const [containerLayout, setContainerLayout] = useState({ width: 0, height: 0 });
    const [pdfScale, setPdfScale] = useState(1);
    const [pdfOffsets, setPdfOffsets] = useState({ top: 0, left: 0 });
    const [isPageLoading, setIsPageLoading] = useState(true);

    const pdfSource = useMemo(() => ({ uri: bookInfo.localUri }), [bookInfo.localUri]);

    const isPlayingRef = useRef(isPlaying);
    const speechStartIndex = useRef(0);
    const timeListenedRef = useRef(0);
    const intervalRef = useRef(null);

    const [showMagnifier, setShowMagnifier] = useState(false);
    const [snapshotUri, setSnapshotUri] = useState(null);

    // Ref do CONTAINER do PDF (exatamente a área renderizada, sem offsets)
    const pdfContainerRef = useRef(null);

    const isLupaVisible = useSharedValue(0);
    const lupaPosition = {
        touchX: useSharedValue(0),
        touchY: useSharedValue(0),
        pdfX: useSharedValue(0),
        pdfY: useSharedValue(0),
    };

    const navLockRef = useRef(false);

    // Cooldown/coalescência para navegação de páginas
    const MIN_PAGE_CHANGE_INTERVAL = 900; // ms
    const lastPageChangeAtRef = useRef(0);
    const pendingNavTimeoutRef = useRef(null);

    const captureSnapshot = useCallback(async () => {
        try {
            if (pdfContainerRef.current) {
                const uri = await captureRef(pdfContainerRef.current, {
                    format: 'jpg',
                    quality: 0.95,
                    result: 'tmpfile',
                });
                if (uri) {
                    setSnapshotUri(uri);
                    setShowMagnifier(true);
                }
            }
        } catch (e) {
            console.warn('Falha ao capturar snapshot da página:', e);
        }
    }, []);

    const panGesture = Gesture.Pan()
        .onBegin((e) => {
            if (pdfScale > 0 && !isPageLoading) {
                // Posição do toque para posicionar o elemento visual da lupa
                lupaPosition.touchX.value = e.x;
                lupaPosition.touchY.value = e.y;

                // Centro da lupa na tela
                const magnifierCenterY = e.y + LUPA_VERTICAL_OFFSET + (LUPA_SIZE / 2);

                // Converte as coordenadas do CENTRO da lupa para coords do PDF (antes do pdfScale)
                lupaPosition.pdfX.value = (e.x - pdfOffsets.left) / pdfScale;
                lupaPosition.pdfY.value = (magnifierCenterY - pdfOffsets.top) / pdfScale;

                isLupaVisible.value = withSpring(1, { damping: 15, stiffness: 200 });
                runOnJS(captureSnapshot)();
            }
        })
        .onUpdate((e) => {
            if (pdfScale > 0 && showMagnifier) {
                // Atualiza a posição do toque
                lupaPosition.touchX.value = e.x;
                lupaPosition.touchY.value = e.y;

                // Centro da lupa na tela
                const magnifierCenterY = e.y + LUPA_VERTICAL_OFFSET + (LUPA_SIZE / 2);

                // Converte para coords do PDF (antes do pdfScale)
                lupaPosition.pdfX.value = (e.x - pdfOffsets.left) / pdfScale;
                lupaPosition.pdfY.value = (magnifierCenterY - pdfOffsets.top) / pdfScale;
            }
        })
        .onEnd(() => {
            isLupaVisible.value = withSpring(0);
            runOnJS(setShowMagnifier)(false);
            runOnJS(setSnapshotUri)(null);
        })
        .onFinalize(() => {
            isLupaVisible.value = withSpring(0);
            runOnJS(setShowMagnifier)(false);
            runOnJS(setSnapshotUri)(null);
        });

    const loadUpdatedBookData = useCallback(async () => {
        const library = await loadLibrary();
        const currentBook = library.find(b => b.id_arquivo === bookInfo.id_arquivo);
        if (currentBook) {
            setBookmarks(currentBook.bookmarks || []);
            setAnnotations(currentBook.annotations || {});
        }
    }, [bookInfo.id_arquivo]);

    useFocusEffect(useCallback(() => { loadUpdatedBookData(); }, [loadUpdatedBookData]));

    useFocusEffect(useCallback(() => {
        navigation.setOptions({ title: bookInfo.nome_original });
        return () => {
            Speech.stop();
            stopTimer();
            updateBookState(bookInfo.id_arquivo, currentPageIndex, timeListenedRef.current);
            timeListenedRef.current = 0;
        };
    }, [bookInfo.id_arquivo, currentPageIndex, navigation, bookInfo.nome_original]));

    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

    useEffect(() => {
        const loadVoice = async () => {
            const savedVoice = await AsyncStorage.getItem('@HearLearn:voicePreference');
            setActiveVoice(savedVoice);
        };
        loadVoice();
    }, []);

    // Escala e centraliza a página para caber inteira
    useEffect(() => {
        if (pdfLayout.width > 1 && pdfLayout.height > 1 && containerLayout.width > 0 && containerLayout.height > 0) {
            const scaleToFitWidth = containerLayout.width / pdfLayout.width;
            const scaleToFitHeight = containerLayout.height / pdfLayout.height;
            const scale = Math.min(scaleToFitWidth, scaleToFitHeight);

            const scaledPdfWidth = pdfLayout.width * scale;
            const scaledPdfHeight = pdfLayout.height * scale;
            const topOffset = (containerLayout.height - scaledPdfHeight) / 2;
            const leftOffset = (containerLayout.width - scaledPdfWidth) / 2;

            setPdfScale(scale);
            setPdfOffsets({ top: topOffset, left: leftOffset });
            setIsPageLoading(false);
        }
    }, [pdfLayout, containerLayout]);

    // Atualiza dados da página e usa dimensões conhecidas (OCR) para escalar
    useEffect(() => {
        setIsPageLoading(true);
        setShowMagnifier(false);
        setSnapshotUri(null);

        if (bookInfo.pagesData && bookInfo.pagesData[currentPageIndex]) {
            const newPageData = bookInfo.pagesData[currentPageIndex];
            setPageData(newPageData);
            setCurrentWordIndex(-1);

            // Usa dimensões do OCR (confiáveis para manter proporção)
            if (newPageData.dimensoes?.largura && newPageData.dimensoes?.altura) {
                setPdfLayout({
                    width: newPageData.dimensoes.largura,
                    height: newPageData.dimensoes.altura
                });
            } else {
                // fallback mínimo (evita ficar sem nada)
                setPdfLayout({ width: 1000, height: 1414 }); // proporção A4 aproximada
            }
        }
    }, [currentPageIndex, bookInfo.pagesData]);

    // Continua leitura automaticamente ao trocar de página se já estava tocando
    useEffect(() => {
        if (isPlaying && pageData?.texto_completo) {
            startSpeech(pageData.texto_completo, playbackRate, 0, activeVoice);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageData]);

    useEffect(() => {
        const hasAnnotation = annotations[currentPageIndex]?.trim() !== '';
        navigation.setOptions({
            headerRight: () => (
                <View style={styles.headerButtons}>
                    <TouchableOpacity onPress={() => { setCurrentAnnotation(annotations[currentPageIndex] || ''); setAnnotationModalVisible(true); }} style={styles.headerIcon}>
                        <Ionicons name={hasAnnotation ? "reader" : "reader-outline"} size={26} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setBookmarkModalVisible(true)} style={styles.headerIcon}>
                        <Ionicons name="list" size={28} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => toggleBookmark(currentPageIndex)}>
                        <Ionicons name={bookmarks.includes(currentPageIndex) ? "bookmark" : "bookmark-outline"} size={24} color={colors.primary} />
                    </TouchableOpacity>
                </View>
            ),
        });
    }, [navigation, colors.primary, bookmarks, annotations, currentPageIndex]);

    const startTimer = () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => { timeListenedRef.current += 1; }, 1000);
    };

    const stopTimer = () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    };

    // Navegação segura (com lock baseado no intervalo mínimo)
    const safeGoTo = useCallback((deltaOrIndex, absolute = false, options = { continueSpeech: false }) => {
        if (navLockRef.current) return;
        navLockRef.current = true;

        const continueSpeech = !!options.continueSpeech;

        setShowMagnifier(false);
        setSnapshotUri(null);
        setIsPageLoading(true);

        Speech.stop(); // evita sobreposição

        if (!continueSpeech) {
            setIsPlaying(false);
            stopTimer();
        }
        setCurrentWordIndex(-1);

        setCurrentPageIndex(prev => {
            if (absolute) return deltaOrIndex;
            return prev + deltaOrIndex;
        });

        // libera o lock após o intervalo mínimo
        setTimeout(() => { navLockRef.current = false; }, MIN_PAGE_CHANGE_INTERVAL);
    }, [stopTimer]);

    // Throttle/coalesce para evitar muitas trocas em sequência
    const throttledGoTo = useCallback((deltaOrIndex, absolute = false, options = { continueSpeech: false }) => {
        const now = Date.now();
        const elapsed = now - lastPageChangeAtRef.current;

        const schedule = (delayMs) => {
            if (pendingNavTimeoutRef.current) clearTimeout(pendingNavTimeoutRef.current);
            pendingNavTimeoutRef.current = setTimeout(() => {
                pendingNavTimeoutRef.current = null;
                lastPageChangeAtRef.current = Date.now();
                safeGoTo(deltaOrIndex, absolute, options);
            }, Math.max(0, delayMs));
        };

        if (isPageLoading || navLockRef.current) {
            schedule(150);
            return;
        }

        if (elapsed >= MIN_PAGE_CHANGE_INTERVAL) {
            lastPageChangeAtRef.current = now;
            safeGoTo(deltaOrIndex, absolute, options);
        } else {
            schedule(MIN_PAGE_CHANGE_INTERVAL - elapsed);
        }
    }, [safeGoTo, isPageLoading]);

    // Limpeza do timeout pendente ao desmontar
    useEffect(() => {
        return () => {
            if (pendingNavTimeoutRef.current) {
                clearTimeout(pendingNavTimeoutRef.current);
                pendingNavTimeoutRef.current = null;
            }
        };
    }, []);

    const startSpeech = useCallback((textToSpeak, rate, fromWordIndex, voiceIdentifier) => {
        if (!textToSpeak || !textToSpeak.trim()) { setIsPlaying(false); return; }
        const words = textToSpeak.split(/\s+/);
        const startIndex = fromWordIndex >= 0 ? fromWordIndex : 0;
        speechStartIndex.current = startIndex;
        const textSegment = words.slice(startIndex).join(' ');
        if (!textSegment) { setIsPlaying(false); return; }
        Speech.speak(textSegment, {
            language: 'pt-BR', rate, voice: voiceIdentifier,
            onDone: () => {
                if (isPlayingRef.current) {
                    if (currentPageIndex < bookInfo.total_paginas - 1) {
                        // Avança e continua lendo com throttle
                        throttledGoTo(1, false, { continueSpeech: true });
                    } else {
                        setIsPlaying(false);
                        stopTimer();
                        setCurrentWordIndex(-1);
                    }
                }
            },
            onError: (error) => {
                console.error("Speech Error:", error);
                setIsPlaying(false);
                stopTimer();
            },
            onBoundary: (event) => {
                if (event.charIndex !== undefined) {
                    const spokenText = textSegment.substring(0, event.charIndex);
                    const currentLocalWordIndex = (spokenText.match(/\s+/g) || []).length;
                    const currentGlobalWordIndex = speechStartIndex.current + currentLocalWordIndex;
                    setCurrentWordIndex(currentGlobalWordIndex);
                }
            },
        });
    }, [currentPageIndex, bookInfo.total_paginas, throttledGoTo]);

    const handlePlayPause = () => {
        if (isPlaying) {
            Speech.stop();
            setIsPlaying(false);
            stopTimer();
        } else {
            if (pageData?.texto_completo) {
                setIsPlaying(true);
                startSpeech(pageData.texto_completo, playbackRate, currentWordIndex >= 0 ? currentWordIndex : 0, activeVoice);
                startTimer();
            }
        }
    };

    const handleNext = () => {
        if (isPageLoading) return;
        if (currentPageIndex < bookInfo.total_paginas - 1) {
            // manual pausa
            throttledGoTo(1, false, { continueSpeech: false });
        }
    };

    const handlePrevious = () => {
        if (isPageLoading) return;
        if (currentPageIndex > 0) {
            // manual pausa
            throttledGoTo(-1, false, { continueSpeech: false });
        }
    };

    const handleChangeRate = (newRate) => {
        setPlaybackRate(newRate);
        if (isPlaying && pageData?.texto_completo) {
            Speech.stop();
            startSpeech(pageData.texto_completo, newRate, currentWordIndex >= 0 ? currentWordIndex : 0, activeVoice);
        }
    };

    const handleJumpToBookmark = (pageIndex) => {
        throttledGoTo(pageIndex, true, { continueSpeech: false });
        setBookmarkModalVisible(false);
    };

    const handleSaveAnnotation = async () => {
        if (currentAnnotation.trim() !== '') {
            await saveAnnotation(bookInfo.id_arquivo, currentPageIndex, currentAnnotation);
        } else {
            await removeAnnotation(bookInfo.id_arquivo, currentPageIndex);
        }
        loadUpdatedBookData();
        setAnnotationModalVisible(false);
    };

    const toggleBookmark = async (pageIndex) => {
        if (bookmarks.includes(pageIndex)) {
            await removeBookmark(bookInfo.id_arquivo, pageIndex);
        } else {
            await addBookmark(bookInfo.id_arquivo, pageIndex);
        }
        loadUpdatedBookData();
    };

    const getWordCoordinates = (wordIndex) => {
        if (!pageData?.palavras || wordIndex < 0 || wordIndex >= pageData.palavras.length) {
            return null;
        }
        return pageData.palavras[wordIndex];
    };

    const renderContent = () => {
        if (!pageData || isPageLoading || !pdfAvailable) {
            if (!pdfAvailable) return <PdfFallback colors={colors} />;
            return <ActivityIndicator size="large" color={colors.primary} style={styles.centered} />;
        }

        if (pageData.extraido_por_ocr || !bookInfo.localUri) {
            return <HighlightedText text={pageData.texto_completo} currentWordIndex={currentWordIndex} colors={colors} />;
        }

        const wordData = getWordCoordinates(currentWordIndex);

        return (
            <GestureDetector gesture={panGesture}>
                <View style={styles.flexOne}>
                    {/* Container absoluto que renderiza a página inteira centralizada */}
                    <View
                        ref={pdfContainerRef}
                        collapsable={false}
                        style={{
                            position: 'absolute',
                            left: pdfOffsets.left,
                            top: pdfOffsets.top,
                            width: pdfLayout.width * pdfScale,
                            height: pdfLayout.height * pdfScale,
                            overflow: 'hidden',
                            backgroundColor: '#fff',
                        }}
                    >
                        <Pdf
                            source={pdfSource}
                            page={currentPageIndex + 1}
                            // Mantém o PDF estático; o container já controla tamanho/centralização
                            enableDoubleTapZoom={false}
                            enablePaging={false}
                            spacing={0}
                            fitPolicy={2}
                            style={{ width: '100%', height: '100%' }}
                            onError={(error) => console.error('Erro ao carregar PDF local:', error)}
                        />
                    </View>

                    {/* Destaque alinhado ao PDF */}
                    {wordData?.coords && pdfScale > 0 && (
                        <View
                            pointerEvents="none"
                            style={[
                                styles.wordHighlight,
                                {
                                    position: 'absolute',
                                    top: (wordData.coords.y0 * pdfScale) + pdfOffsets.top,
                                    left: (wordData.coords.x0 * pdfScale) + pdfOffsets.left,
                                    width: (wordData.coords.x1 - wordData.coords.x0) * pdfScale,
                                    height: (wordData.coords.y1 - wordData.coords.y0) * pdfScale,
                                    backgroundColor: colors.primary,
                                }
                            ]}
                        />
                    )}

                    {/* Lupa com zoom */}
                    {showMagnifier && snapshotUri && (
                        <Magnifier
                            snapshotUri={snapshotUri}
                            isVisible={isLupaVisible}
                            position={lupaPosition}
                            pdfLayout={pdfLayout}
                            pdfScale={pdfScale}
                            pageData={pageData}
                            currentWordIndex={currentWordIndex}
                        />
                    )}
                </View>
            </GestureDetector>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <Modal animationType="slide" transparent={true} visible={annotationModalVisible} onRequestClose={() => setAnnotationModalVisible(false)}>
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalContainer}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>Anotação - Página {currentPageIndex + 1}</Text>
                        <TextInput style={[styles.annotationInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.subtext }]} multiline placeholder="Escreva sua nota aqui..." placeholderTextColor={colors.subtext} value={currentAnnotation} onChangeText={setCurrentAnnotation} autoFocus />
                        <View style={styles.modalButtons}>
                            <TouchableOpacity onPress={() => setAnnotationModalVisible(false)} style={styles.cancelButton}><Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancelar</Text></TouchableOpacity>
                            <TouchableOpacity onPress={handleSaveAnnotation} style={[styles.saveButton, { backgroundColor: colors.primary }]}><Text style={styles.saveButtonText}>Salvar</Text></TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
            <Modal animationType="slide" transparent={true} visible={bookmarkModalVisible} onRequestClose={() => setBookmarkModalVisible(false)}>
                <View style={styles.modalContainer}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>Marcadores</Text>
                        <ScrollView>
                            {bookmarks.length > 0 ? (
                                bookmarks.map((page, index) => (
                                    <TouchableOpacity key={index} style={styles.bookmarkItem} onPress={() => handleJumpToBookmark(page)}>
                                        <Ionicons name="bookmark" size={20} color={colors.primary} />
                                        <Text style={[styles.bookmarkText, { color: colors.text }]}>Página {page + 1}</Text>
                                    </TouchableOpacity>
                                ))
                            ) : (<Text style={[styles.noBookmarksText, { color: colors.subtext }]}>Nenhuma página marcada.</Text>)}
                        </ScrollView>
                        <TouchableOpacity onPress={() => setBookmarkModalVisible(false)} style={[styles.closeButton, { backgroundColor: colors.primary }]}><Text style={styles.closeButtonText}>Fechar</Text></TouchableOpacity>
                    </View>
                </View>
            </Modal>

            <View
                style={styles.contentArea}
                onLayout={(event) => {
                    const { width, height } = event.nativeEvent.layout;
                    if (width > 0 && height > 0 && (width !== containerLayout.width || height !== containerLayout.height)) {
                        setContainerLayout({ width, height });
                    }
                }}
            >
                {renderContent()}
            </View>

            <View style={[styles.controlsContainer, { borderTopColor: colors.subtext }]}>
                <Text style={[styles.pageIndicator, { color: colors.subtext }]}>Página {currentPageIndex + 1} de {bookInfo.total_paginas}</Text>
                <View style={styles.playerControls}>
                    <TouchableOpacity onPress={handlePrevious} disabled={currentPageIndex === 0 || isPageLoading}><Ionicons name="play-skip-back-circle-outline" size={50} color={currentPageIndex === 0 || isPageLoading ? colors.subtext : colors.text} /></TouchableOpacity>
                    <TouchableOpacity onPress={handlePlayPause} disabled={!pageData}><Ionicons name={isPlaying ? 'pause-circle' : 'play-circle'} size={80} color={!pageData ? colors.subtext : colors.primary} /></TouchableOpacity>
                    <TouchableOpacity onPress={handleNext} disabled={currentPageIndex >= bookInfo.total_paginas - 1 || isPageLoading}><Ionicons name="play-skip-forward-circle-outline" size={50} color={currentPageIndex >= bookInfo.total_paginas - 1 || isPageLoading ? colors.subtext : colors.text} /></TouchableOpacity>
                </View>
                <View style={styles.speedControls}>
                    <Text style={[styles.speedLabel, { color: colors.text }]}>Velocidade:</Text>
                    {[1.0, 1.25, 1.5, 2.0].map((speed) => (
                        <TouchableOpacity key={speed} style={[styles.speedButton, { borderColor: colors.subtext }, playbackRate === speed && { backgroundColor: colors.primary, borderColor: colors.primary }]} onPress={() => handleChangeRate(speed)}>
                            <Text style={playbackRate === speed ? styles.speedButtonTextActive : [styles.speedButtonText, { color: colors.text }]}>{speed.toFixed(1)}x</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    contentArea: { flex: 3, overflow: 'hidden' },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    flexOne: { flex: 1 },
    lupaContainer: {
        position: 'absolute',
        width: LUPA_SIZE,
        height: LUPA_SIZE,
        borderRadius: LUPA_SIZE / 2,
        borderWidth: 3,
        overflow: 'hidden',
        elevation: 10,
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 5 },
        backgroundColor: '#fff',
    },
    wordHighlight: { position: 'absolute', opacity: 0.4, borderRadius: 3, },
    textContainerScrollView: { padding: 20 },
    textContainer: { fontSize: 20, lineHeight: 30 },
    highlightedWord: { paddingVertical: 2, paddingHorizontal: 3, borderRadius: 4, overflow: 'hidden' },
    controlsContainer: { flex: 2, justifyContent: 'center', borderTopWidth: 1, paddingVertical: 10, paddingHorizontal: 20 },
    pageIndicator: { fontSize: 16, textAlign: 'center', marginBottom: 15, fontWeight: '600' },
    playerControls: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', width: '100%', marginBottom: 20 },
    speedControls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', width: '100%', marginTop: 10 },
    speedLabel: { fontSize: 16, marginRight: 15, fontWeight: '500' },
    speedButton: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1.5, marginHorizontal: 5 },
    speedButtonText: { fontSize: 14, fontWeight: 'bold' },
    speedButtonTextActive: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
    modalContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.5)' },
    modalContent: { width: '85%', maxHeight: '60%', borderRadius: 12, padding: 20, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4 },
    modalTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
    bookmarkItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
    bookmarkText: { fontSize: 18, marginLeft: 15 },
    noBookmarksText: { fontSize: 16, textAlign: 'center', marginTop: 20 },
    closeButton: { marginTop: 20, padding: 12, borderRadius: 8, alignItems: 'center' },
    closeButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    annotationInput: { height: 150, textAlignVertical: 'top', padding: 15, fontSize: 16, borderRadius: 8, borderWidth: 1, marginBottom: 20 },
    modalButtons: { flexDirection: 'row', justifyContent: 'flex-end' },
    cancelButton: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, marginRight: 10 },
    saveButton: { paddingVertical: 10, paddingHorizontal: 25, borderRadius: 8 },
    saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    headerButtons: { flexDirection: 'row', alignItems: 'center' },
    headerIcon: { marginRight: 15 },
    fallbackText: { fontSize: 18, fontWeight: '500', marginTop: 15, textAlign: 'center' },
    fallbackSubtext: { fontSize: 14, marginTop: 10, textAlign: 'center', lineHeight: 20 },
});