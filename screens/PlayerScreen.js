// /Front-and/screens/PlayerScreen.js
import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import {
    StyleSheet, Text, View, TouchableOpacity, ScrollView,
    ActivityIndicator, Alert, Modal, TextInput, KeyboardAvoidingView, Platform
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { updateBookState, addBookmark, removeBookmark, loadLibrary, saveAnnotation, removeAnnotation } from '../utils/libraryManager';

// Componente HighlightedText para fallback
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

// Componente WebView para PDF com destaque de palavras
const PdfWebViewWithHighlight = ({ source, page, colors, wordCoordinates, onError, onLoad }) => {
    const webViewRef = useRef(null);

    // Função para destacar palavra via JavaScript
    const highlightWord = useCallback((coords) => {
        if (!webViewRef.current || !coords) return;

        const jsCode = `
            (function() {
                // Remove highlight anterior
                const existingHighlight = document.getElementById('word-highlight');
                if (existingHighlight) {
                    existingHighlight.remove();
                }
                
                // Cria novo highlight
                const highlight = document.createElement('div');
                highlight.id = 'word-highlight';
                highlight.style.position = 'absolute';
                highlight.style.left = '${coords.x0}px';
                highlight.style.top = '${coords.y0}px';
                highlight.style.width = '${coords.x1 - coords.x0}px';
                highlight.style.height = '${coords.y1 - coords.y0}px';
                highlight.style.backgroundColor = '${colors.primary}';
                highlight.style.opacity = '0.4';
                highlight.style.borderRadius = '3px';
                highlight.style.pointerEvents = 'none';
                highlight.style.zIndex = '1000';
                
                // Adiciona ao viewer
                const viewer = document.getElementById('pdf-viewer');
                if (viewer) {
                    viewer.appendChild(highlight);
                }
                
                // Auto-scroll para a palavra
                highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
            })();
        `;

        webViewRef.current.postMessage(jsCode);
    }, [colors.primary]);

    // Atualiza highlight quando coordenadas mudam
    useEffect(() => {
        if (wordCoordinates) {
            highlightWord(wordCoordinates);
        }
    }, [wordCoordinates, highlightWord]);

    // HTML para renderizar PDF com PDF.js
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { 
                    margin: 0; 
                    padding: 0; 
                    background: #f0f0f0; 
                    font-family: Arial, sans-serif;
                }
                #pdf-viewer { 
                    width: 100%; 
                    height: 100vh; 
                    position: relative;
                    overflow: auto;
                }
                #pdf-canvas { 
                    display: block; 
                    margin: 0 auto; 
                    max-width: 100%;
                    position: relative;
                }
                .loading { 
                    text-align: center; 
                    padding: 20px; 
                    color: #666;
                }
                .error {
                    text-align: center;
                    padding: 20px;
                    color: #d32f2f;
                    background: #ffebee;
                    margin: 20px;
                    border-radius: 8px;
                }
            </style>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js"></script>
        </head>
        <body>
            <div id="pdf-viewer">
                <div class="loading">Carregando PDF...</div>
            </div>
            
            <script>
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
                
                let currentPdf = null;
                let currentPage = null;
                let currentScale = 1.5;
                
                async function loadPdf() {
                    try {
                        const loadingTask = pdfjsLib.getDocument('${source}');
                        currentPdf = await loadingTask.promise;
                        await renderPage(${page});
                        
                        // Notifica que carregou
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'loaded',
                            totalPages: currentPdf.numPages
                        }));
                    } catch (error) {
                        console.error('Erro ao carregar PDF:', error);
                        showError('Erro ao carregar PDF: ' + error.message);
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'error',
                            message: error.message
                        }));
                    }
                }
                
                async function renderPage(pageNumber) {
                    try {
                        currentPage = await currentPdf.getPage(pageNumber);
                        const viewport = currentPage.getViewport({ scale: currentScale });
                        
                        // Limpa viewer anterior
                        const viewer = document.getElementById('pdf-viewer');
                        viewer.innerHTML = '';
                        
                        // Cria canvas
                        const canvas = document.createElement('canvas');
                        canvas.id = 'pdf-canvas';
                        const context = canvas.getContext('2d');
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        
                        // Renderiza página
                        const renderContext = {
                            canvasContext: context,
                            viewport: viewport
                        };
                        
                        await currentPage.render(renderContext).promise;
                        viewer.appendChild(canvas);
                        
                        // Ajusta tamanho do viewer
                        viewer.style.height = viewport.height + 'px';
                        viewer.style.width = viewport.width + 'px';
                        
                    } catch (error) {
                        console.error('Erro ao renderizar página:', error);
                        showError('Erro ao renderizar página: ' + error.message);
                    }
                }
                
                function showError(message) {
                    const viewer = document.getElementById('pdf-viewer');
                    viewer.innerHTML = '<div class="error">' + message + '</div>';
                }
                
                function zoomIn() {
                    currentScale *= 1.2;
                    if (currentPage) renderPage(currentPage.pageNumber);
                }
                
                function zoomOut() {
                    currentScale /= 1.2;
                    if (currentPage) renderPage(currentPage.pageNumber);
                }
                
                // Escuta mensagens do React Native
                window.addEventListener('message', function(event) {
                    const data = JSON.parse(event.data);
                    if (data.type === 'zoom') {
                        if (data.action === 'in') zoomIn();
                        else if (data.action === 'out') zoomOut();
                    }
                });
                
                // Escuta mensagens via postMessage (para highlight)
                document.addEventListener('message', function(event) {
                    if (typeof event.data === 'string') {
                        try {
                            eval(event.data);
                        } catch (e) {
                            console.error('Erro ao executar JS:', e);
                        }
                    }
                });
                
                // Carrega PDF quando a página estiver pronta
                loadPdf();
            </script>
        </body>
        </html>
    `;

    return (
        <WebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={{ html: htmlContent }}
            style={styles.webview}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            allowFileAccess={true}
            allowUniversalAccessFromFileURLs={true}
            onMessage={(event) => {
                try {
                    const data = JSON.parse(event.nativeEvent.data);
                    if (data.type === 'loaded') {
                        onLoad && onLoad(data);
                    } else if (data.type === 'error') {
                        onError && onError(data.message);
                    }
                } catch (e) {
                    console.log('Mensagem não-JSON do WebView:', event.nativeEvent.data);
                }
            }}
            onError={(error) => {
                console.error('WebView Error:', error);
                onError && onError(error.nativeEvent.description);
            }}
            onLoadEnd={() => {
                console.log('WebView carregou');
            }}
        />
    );
};

// Componente de fallback
const PdfFallback = ({ colors, message = "Visualização em PDF não disponível" }) => (
    <View style={[styles.centered, { padding: 20 }]}>
        <Ionicons name="document-text-outline" size={80} color={colors.subtext} />
        <Text style={[styles.fallbackText, { color: colors.text }]}>
            {message}
        </Text>
        <Text style={[styles.fallbackSubtext, { color: colors.subtext }]}>
            Exibindo conteúdo em modo texto
        </Text>
    </View>
);

export default function PlayerScreen({ route }) {
    // Verificação inicial das informações do livro
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

    // Estados
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
    const [pdfError, setPdfError] = useState(false);
    const [viewMode, setViewMode] = useState('auto'); // 'auto', 'text', 'pdf'
    const [pdfLoaded, setPdfLoaded] = useState(false);

    // Refs
    const isPlayingRef = useRef(isPlaying);
    const speechStartIndex = useRef(0);
    const timeListenedRef = useRef(0);
    const intervalRef = useRef(null);

    // Hooks existentes
    const loadBookData = useCallback(async () => {
        const library = await loadLibrary();
        const currentBook = library.find(b => b.id_arquivo === bookInfo.id_arquivo);
        if (currentBook) {
            setBookmarks(currentBook.bookmarks || []);
            setAnnotations(currentBook.annotations || {});
        }
    }, [bookInfo.id_arquivo]);

    useFocusEffect(useCallback(() => { loadBookData(); }, [loadBookData]));

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
        if (bookInfo.pagesData && bookInfo.pagesData[currentPageIndex]) {
            const newPageData = bookInfo.pagesData[currentPageIndex];
            setPageData(newPageData);
            setCurrentWordIndex(-1);
            setPdfError(false);
            setPdfLoaded(false);
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
                    <TouchableOpacity
                        onPress={() => setViewMode(viewMode === 'text' ? 'pdf' : 'text')}
                        style={styles.headerIcon}
                    >
                        <Ionicons
                            name={viewMode === 'text' ? "document-text" : "document"}
                            size={24}
                            color={colors.primary}
                        />
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => {
                            setCurrentAnnotation(annotations[currentPageIndex] || '');
                            setAnnotationModalVisible(true);
                        }}
                        style={styles.headerIcon}
                    >
                        <Ionicons
                            name={hasAnnotation ? "reader" : "reader-outline"}
                            size={26}
                            color={colors.primary}
                        />
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => setBookmarkModalVisible(true)}
                        style={styles.headerIcon}
                    >
                        <Ionicons name="list" size={28} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => toggleBookmark(currentPageIndex)}>
                        <Ionicons
                            name={bookmarks.includes(currentPageIndex) ? "bookmark" : "bookmark-outline"}
                            size={24}
                            color={colors.primary}
                        />
                    </TouchableOpacity>
                </View>
            ),
        });
    }, [navigation, colors.primary, bookmarks, annotations, currentPageIndex, viewMode]);

    // Funções auxiliares
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

    const getWordCoordinates = (wordIndex) => {
        if (!pageData?.palavras || wordIndex < 0 || wordIndex >= pageData.palavras.length) {
            return null;
        }
        return pageData.palavras[wordIndex]?.coords;
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
        loadBookData();
        setAnnotationModalVisible(false);
    };

    const toggleBookmark = async (pageIndex) => {
        if (bookmarks.includes(pageIndex)) {
            await removeBookmark(bookInfo.id_arquivo, pageIndex);
        } else {
            await addBookmark(bookInfo.id_arquivo, pageIndex);
        }
        loadBookData();
    };

    const renderContent = () => {
        if (!pageData) {
            return <ActivityIndicator size="large" color={colors.primary} style={styles.centered} />;
        }

        // Determinar modo de visualização
        const shouldShowText = viewMode === 'text' ||
            pageData.extraido_por_ocr ||
            !bookInfo.localUri ||
            pdfError;

        if (shouldShowText) {
            return (
                <HighlightedText
                    text={pageData.texto_completo}
                    currentWordIndex={currentWordIndex}
                    colors={colors}
                />
            );
        }

        // Tentar mostrar PDF via WebView com coordenadas
        if (viewMode === 'pdf' && bookInfo.localUri) {
            const wordCoords = getWordCoordinates(currentWordIndex);

            return (
                <PdfWebViewWithHighlight
                    source={bookInfo.localUri}
                    page={currentPageIndex + 1}
                    colors={colors}
                    wordCoordinates={wordCoords}
                    onError={(error) => {
                        console.error('Erro ao carregar PDF:', error);
                        setPdfError(true);
                    }}
                    onLoad={(data) => {
                        setPdfLoaded(true);
                        console.log('PDF carregado, total de páginas:', data.totalPages);
                    }}
                />
            );
        }

        // Fallback
        return <PdfFallback colors={colors} />;
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Modais permanecem os mesmos */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={annotationModalVisible}
                onRequestClose={() => setAnnotationModalVisible(false)}
            >
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalContainer}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>
                            Anotação - Página {currentPageIndex + 1}
                        </Text>
                        <TextInput
                            style={[styles.annotationInput, {
                                color: colors.text,
                                backgroundColor: colors.background,
                                borderColor: colors.subtext
                            }]}
                            multiline
                            placeholder="Escreva sua nota aqui..."
                            placeholderTextColor={colors.subtext}
                            value={currentAnnotation}
                            onChangeText={setCurrentAnnotation}
                            autoFocus
                        />
                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                onPress={() => setAnnotationModalVisible(false)}
                                style={styles.cancelButton}
                            >
                                <Text style={[styles.cancelButtonText, { color: colors.text }]}>
                                    Cancelar
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={handleSaveAnnotation}
                                style={[styles.saveButton, { backgroundColor: colors.primary }]}
                            >
                                <Text style={styles.saveButtonText}>Salvar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            <Modal
                animationType="slide"
                transparent={true}
                visible={bookmarkModalVisible}
                onRequestClose={() => setBookmarkModalVisible(false)}
            >
                <View style={styles.modalContainer}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>Marcadores</Text>
                        <ScrollView>
                            {bookmarks.length > 0 ? (
                                bookmarks.map((page, index) => (
                                    <TouchableOpacity
                                        key={index}
                                        style={styles.bookmarkItem}
                                        onPress={() => handleJumpToBookmark(page)}
                                    >
                                        <Ionicons name="bookmark" size={20} color={colors.primary} />
                                        <Text style={[styles.bookmarkText, { color: colors.text }]}>
                                            Página {page + 1}
                                        </Text>
                                    </TouchableOpacity>
                                ))
                            ) : (
                                <Text style={[styles.noBookmarksText, { color: colors.subtext }]}>
                                    Nenhuma página marcada.
                                </Text>
                            )}
                        </ScrollView>
                        <TouchableOpacity
                            onPress={() => setBookmarkModalVisible(false)}
                            style={[styles.closeButton, { backgroundColor: colors.primary }]}
                        >
                            <Text style={styles.closeButtonText}>Fechar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            <View style={styles.contentArea}>
                {renderContent()}
            </View>

            <View style={[styles.controlsContainer, { borderTopColor: colors.subtext }]}>
                <Text style={[styles.pageIndicator, { color: colors.subtext }]}>
                    Página {currentPageIndex + 1} de {bookInfo.total_paginas}
                </Text>
                <View style={styles.playerControls}>
                    <TouchableOpacity
                        onPress={handlePrevious}
                        disabled={currentPageIndex === 0}
                    >
                        <Ionicons
                            name="play-skip-back-circle-outline"
                            size={50}
                            color={currentPageIndex === 0 ? colors.subtext : colors.text}
                        />
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={handlePlayPause}
                        disabled={!pageData}
                    >
                        <Ionicons
                            name={isPlaying ? 'pause-circle' : 'play-circle'}
                            size={80}
                            color={!pageData ? colors.subtext : colors.primary}
                        />
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={handleNext}
                        disabled={currentPageIndex >= bookInfo.total_paginas - 1}
                    >
                        <Ionicons
                            name="play-skip-forward-circle-outline"
                            size={50}
                            color={currentPageIndex >= bookInfo.total_paginas - 1 ? colors.subtext : colors.text}
                        />
                    </TouchableOpacity>
                </View>
                <View style={styles.speedControls}>
                    <Text style={[styles.speedLabel, { color: colors.text }]}>Velocidade:</Text>
                    {[1.0, 1.25, 1.5, 2.0].map((speed) => (
                        <TouchableOpacity
                            key={speed}
                            style={[
                                styles.speedButton,
                                { borderColor: colors.subtext },
                                playbackRate === speed && { backgroundColor: colors.primary, borderColor: colors.primary }
                            ]}
                            onPress={() => handleChangeRate(speed)}
                        >
                            <Text style={playbackRate === speed ?
                                styles.speedButtonTextActive :
                                [styles.speedButtonText, { color: colors.text }]
                            }>
                                {speed.toFixed(1)}x
                            </Text>
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
    pdf: { flex: 1, width: '100%', height: '100%' },
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