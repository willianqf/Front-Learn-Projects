import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import {
    StyleSheet, Text, View, TouchableOpacity, ScrollView,
    ActivityIndicator, Alert, Modal, TextInput, KeyboardAvoidingView, Platform, Dimensions
} from 'react-native';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { updateBookState, addBookmark, removeBookmark, saveAnnotation, removeAnnotation, loadLibrary } from '../utils/libraryManager';

import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';


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

const LUPA_SIZE = 200;
const ZOOM_FACTOR = 1;

const LUPA_VERTICAL_OFFSET = -LUPA_SIZE * 1.25;
// Substitua o componente Magnifier inteiro por este

const Magnifier = ({ source, page, isVisible, position, pdfLayout, pageData, currentWordIndex }) => {
    const { colors } = useContext(ThemeContext);

    const magnifierStyle = useAnimatedStyle(() => {
        return {
            opacity: isVisible.value,
            top: position.touchY.value + LUPA_VERTICAL_OFFSET,
            left: position.touchX.value - LUPA_SIZE / 2,
            transform: [{ scale: withSpring(isVisible.value) }]
        };
    });

    const contentStyle = useAnimatedStyle(() => {
        const translateX = -position.pdfX.value * ZOOM_FACTOR + LUPA_SIZE / 2;
        const translateY = -position.pdfY.value * ZOOM_FACTOR + LUPA_SIZE / 2;

        return {
            width: pdfLayout.width,
            height: pdfLayout.height,
            transform: [
                { translateX },
                { translateY },
                { scale: ZOOM_FACTOR },
            ],
        };
    });

    // --- LÓGICA DO DESTAQUE ADICIONADA AQUI ---
    // Pega os dados da palavra atual para o destaque
    const wordData =
        pageData?.palavras && currentWordIndex >= 0 && currentWordIndex < pageData.palavras.length
            ? pageData.palavras[currentWordIndex]
            : null;

    if (!pdfAvailable || !pdfLayout.width || !pdfLayout.height) return null;

    return (
        <Animated.View style={[styles.lupaContainer, { borderColor: colors.primary, width: LUPA_SIZE, height: LUPA_SIZE, borderRadius: LUPA_SIZE / 2 }, magnifierStyle]} pointerEvents="none">
            <Animated.View style={[{ width: pdfLayout.width, height: pdfLayout.height, backgroundColor: 'white', overflow: 'hidden' }, contentStyle]}>
                <Pdf
                    source={source}
                    page={page}
                    style={{ flex: 1 }}
                    fitPolicy={0}
                    enableDoubleTapZoom={false} // Mantemos o zoom desativado aqui também
                />

                {/* --- RENDERIZAÇÃO DO DESTAQUE DENTRO DA LUPA --- */}
                {wordData?.coords && (
                    <View
                        style={[
                            styles.wordHighlight, // Reutilizamos o estilo de opacidade
                            {
                                position: 'absolute',
                                // Usamos as coordenadas originais da palavra
                                top: wordData.coords.y0,
                                left: wordData.coords.x0,
                                width: wordData.coords.x1 - wordData.coords.x0,
                                height: wordData.coords.y1 - wordData.coords.y0,
                                backgroundColor: colors.primary,
                            }
                        ]}
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

    const isPlayingRef = useRef(isPlaying);
    const speechStartIndex = useRef(0);
    const timeListenedRef = useRef(0);
    const intervalRef = useRef(null);

    const isLupaVisible = useSharedValue(0);
    const lupaPosition = {
        touchX: useSharedValue(0),
        touchY: useSharedValue(0),
        pdfX: useSharedValue(0),
        pdfY: useSharedValue(0),
    };


    const panGesture = Gesture.Pan()
        .onBegin((e) => {
            if (pdfScale > 0) {
                // Armazena a posição do toque (dedo)
                lupaPosition.touchX.value = e.x;
                lupaPosition.touchY.value = e.y;

                // Calcula a posição do CENTRO da Lupa na tela
                const magnifierCenterX = e.x; // Horizontalmente, o centro da lupa e o dedo estão alinhados
                const magnifierCenterY = e.y + LUPA_VERTICAL_OFFSET + (LUPA_SIZE / 2); // Verticalmente, consideramos o deslocamento

                // Converte as coordenadas do centro da lupa para as coordenadas do PDF original
                lupaPosition.pdfX.value = (magnifierCenterX - pdfOffsets.left) / pdfScale;
                lupaPosition.pdfY.value = (magnifierCenterY - pdfOffsets.top) / pdfScale;

                isLupaVisible.value = withSpring(1, { damping: 15, stiffness: 200 });
            }
        })
        .onUpdate((e) => {
            if (pdfScale > 0) {
                // Repete a mesma lógica durante o movimento
                lupaPosition.touchX.value = e.x;
                lupaPosition.touchY.value = e.y;

                const magnifierCenterX = e.x;
                const magnifierCenterY = e.y + LUPA_VERTICAL_OFFSET + (LUPA_SIZE / 2);

                lupaPosition.pdfX.value = (magnifierCenterX - pdfOffsets.left) / pdfScale;
                lupaPosition.pdfY.value = (magnifierCenterY - pdfOffsets.top) / pdfScale;
            }
        })
        .onEnd(() => {
            isLupaVisible.value = withSpring(0);
        })
        .onFinalize(() => {
            isLupaVisible.value = withSpring(0);
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

    useEffect(() => {
        if (pdfLayout.width > 1 && containerLayout.width > 0 && containerLayout.height > 0) {
            // Calcula a escala para caber na largura e na altura
            const scaleToFitWidth = containerLayout.width / pdfLayout.width;
            const scaleToFitHeight = containerLayout.height / pdfLayout.height;
            const scale = Math.min(scaleToFitWidth, scaleToFitHeight);

            // Calcula as dimensões e os deslocamentos
            const scaledPdfWidth = pdfLayout.width * scale;
            const scaledPdfHeight = pdfLayout.height * scale;
            const topOffset = (containerLayout.height - scaledPdfHeight) / 2;
            const leftOffset = (containerLayout.width - scaledPdfWidth) / 2;

            // 1. Primeiro, agenda as atualizações de layout
            setPdfScale(scale);
            setPdfOffsets({ top: topOffset, left: leftOffset });

            // 2. SÓ DEPOIS, sinaliza que o carregamento terminou
            setIsPageLoading(false);
        }
    }, [pdfLayout, containerLayout]);

    useEffect(() => {
        setIsPageLoading(true);
        if (bookInfo.pagesData && bookInfo.pagesData[currentPageIndex]) {
            const newPageData = bookInfo.pagesData[currentPageIndex];
            setPageData(newPageData);
            setCurrentWordIndex(-1);

            if (newPageData.dimensoes && newPageData.dimensoes.largura > 0) {
                setPdfLayout({
                    width: newPageData.dimensoes.largura,
                    height: newPageData.dimensoes.altura
                });
            }
        }
    }, [currentPageIndex, bookInfo.pagesData]);

    useEffect(() => {
        if (isPlaying && pageData?.texto_completo) {
            startSpeech(pageData.texto_completo, playbackRate, 0, activeVoice);
        }
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
                        setCurrentPageIndex(prev => prev + 1);
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
    }, [currentPageIndex, bookInfo.total_paginas]);

    const stopPlayback = () => {
        Speech.stop();
        setIsPlaying(false);
        stopTimer();
    };

    const handlePlayPause = () => {
        if (isPlaying) {
            stopPlayback();
        } else {
            if (pageData?.texto_completo) {
                setIsPlaying(true);
                startSpeech(pageData.texto_completo, playbackRate, currentWordIndex >= 0 ? currentWordIndex : 0, activeVoice);
                startTimer();
            }
        }
    };

    const handleNext = () => {
        if (currentPageIndex < bookInfo.total_paginas - 1) {
            stopPlayback();
            setCurrentPageIndex((prev) => prev + 1);
        }
    };

    const handlePrevious = () => {
        if (currentPageIndex > 0) {
            stopPlayback();
            setCurrentPageIndex((prev) => prev - 1);
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
        stopPlayback();
        setCurrentPageIndex(pageIndex);
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
        if (isPageLoading || !pageData) {
            return <ActivityIndicator size="large" color={colors.primary} style={styles.centered} />;
        }

        if (pageData.extraido_por_ocr || !bookInfo.localUri) {
            return <HighlightedText text={pageData.texto_completo} currentWordIndex={currentWordIndex} colors={colors} />;
        }

        if (!pdfAvailable) {
            return <PdfFallback colors={colors} />;
        }

        const wordData = getWordCoordinates(currentWordIndex);

        return (
            <GestureDetector gesture={panGesture}>
                {/* Usamos um container que preenche a área para posicionar os elementos */}
                <View style={styles.flexOne}>
                    {/* Container do PDF posicionado de forma absoluta para garantir a centralização */}
                    <View
                        style={{
                            position: 'absolute',
                            left: pdfOffsets.left,
                            top: pdfOffsets.top,
                            width: pdfLayout.width * pdfScale,
                            height: pdfLayout.height * pdfScale,
                        }}
                    >
                        <Pdf
                            key={`pdf-page-${currentPageIndex}`}
                            source={{ uri: bookInfo.localUri }}
                            page={currentPageIndex + 1}
                            style={styles.flexOne} // Ocupa todo o container
                            onError={(error) => console.error('Erro ao carregar PDF local:', error)}
                            fitPolicy={0} // A política de ajuste não é mais crítica, mas pode ser mantida
                            enablePaging={false}
                            enableDoubleTapZoom={false}
                        />
                    </View>

                    {/* Destaque de palavra (agora usará os offsets corretos) */}
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

                    {/* A Lupa (agora receberá as coordenadas corretas) */}
                    <Magnifier
                        source={{ uri: bookInfo.localUri }}
                        page={currentPageIndex + 1}
                        isVisible={isLupaVisible}
                        position={lupaPosition}
                        pdfLayout={pdfLayout}
                        // Adicione as duas linhas abaixo
                        pageData={pageData}
                        currentWordIndex={currentWordIndex}
                    />
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
                    <TouchableOpacity onPress={handlePrevious} disabled={currentPageIndex === 0}><Ionicons name="play-skip-back-circle-outline" size={50} color={currentPageIndex === 0 ? colors.subtext : colors.text} /></TouchableOpacity>
                    <TouchableOpacity onPress={handlePlayPause} disabled={!pageData}><Ionicons name={isPlaying ? 'pause-circle' : 'play-circle'} size={80} color={!pageData ? colors.subtext : colors.primary} /></TouchableOpacity>
                    <TouchableOpacity onPress={handleNext} disabled={currentPageIndex >= bookInfo.total_paginas - 1}><Ionicons name="play-skip-forward-circle-outline" size={50} color={currentPageIndex >= bookInfo.total_paginas - 1 ? colors.subtext : colors.text} /></TouchableOpacity>
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
    pdf: {},
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
    cancelButtonText: { fontSize: 16, fontWeight: '500' },
    saveButton: { paddingVertical: 10, paddingHorizontal: 25, borderRadius: 8 },
    saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    headerButtons: { flexDirection: 'row', alignItems: 'center' },
    headerIcon: { marginRight: 15 },
    fallbackText: { fontSize: 18, fontWeight: '500', marginTop: 15, textAlign: 'center' },
    fallbackSubtext: { fontSize: 14, marginTop: 10, textAlign: 'center', lineHeight: 20 },
});