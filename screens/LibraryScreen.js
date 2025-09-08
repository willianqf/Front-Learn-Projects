// /Front-and/screens/LibraryScreen.js

import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Alert, ActivityIndicator, Image, SafeAreaView, Dimensions, Modal } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import axios from 'axios';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { loadLibrary, saveBook, removeBook, loadBookPages, appendPageData, updateBookStatus } from '../utils/libraryManager';
import LogoApp from '../assets/LogoApp.png';
import * as FileSystem from 'expo-file-system';

const API_BASE_URL = 'https://willianqf-audio-transcriber.hf.space';
const cardColors = ['#2EC4B6', '#E71D36', '#FF9F1C', '#54478C', '#011627', '#20A4F3'];

// Um objeto para controlar os processos em andamento e evitar múltiplas execuções para o mesmo livro
const processingControl = {};

const getInitials = (name) => {
    if (!name) return '??';
    const words = name.split(' ');
    if (words.length > 1) {
        return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
};

export default function LibraryScreen() {
    const navigation = useNavigation();
    const isFocused = useIsFocused();
    const { colors } = useContext(ThemeContext);

    const [library, setLibrary] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState({});

    const isAnyBookProcessing = library.some(book => book.status === 'processing');
    const isButtonDisabled = isUploading || isAnyBookProcessing;

    const loadBooksFromStorage = useCallback(async () => {
        const books = await loadLibrary();
        setLibrary(books);

        const initialProgress = {};
        for (const book of books) {
            if (book.status === 'processing' || book.status === 'ready') {
                const pages = await loadBookPages(book.id_arquivo);
                const pageCount = pages?.length || 0;
                if (book.total_paginas > 0) {
                    initialProgress[book.id_arquivo] = pageCount / book.total_paginas;
                }
                if (book.status === 'processing' && pageCount === book.total_paginas) {
                    await updateBookStatus(book.id_arquivo, 'ready');
                }
            }
        }
        setProgress(initialProgress);
    }, []);

    useEffect(() => {
        if (isFocused) {
            loadBooksFromStorage();
        }
    }, [isFocused, loadBooksFromStorage]);

    const processBookPages = useCallback(async (bookInfo) => {
        if (processingControl[bookInfo.id_arquivo]) {
            return;
        }
        processingControl[bookInfo.id_arquivo] = true;
        console.log(`Iniciando processamento para: ${bookInfo.nome_original}`);

        const processPage = async (pageNumber) => {
            if (pageNumber > bookInfo.total_paginas) {
                await updateBookStatus(bookInfo.id_arquivo, 'ready');
                console.log(`Livro ${bookInfo.nome_original} processado com sucesso!`);
                delete processingControl[bookInfo.id_arquivo];
                loadBooksFromStorage();
                return;
            }

            const currentLibrary = await loadLibrary();
            if (!currentLibrary.some(b => b.id_arquivo === bookInfo.id_arquivo)) {
                console.log(`Processamento cancelado para ${bookInfo.nome_original}, livro removido.`);
                delete processingControl[bookInfo.id_arquivo];
                return;
            }

            try {
                const response = await axios.post(`${API_BASE_URL}/obter_dados_pagina`, {
                    id_arquivo: bookInfo.id_arquivo,
                    numero_pagina: pageNumber
                }, { timeout: 60000 });

                if (response.data && response.data.status === 'sucesso') {
                    const pageData = response.data.dados;

                    if (pageNumber === 1 && pageData.idioma && !pageData.idioma.startsWith('pt')) {
                        Alert.alert(
                            "Idioma Diferente Detectado",
                            `Este livro parece não estar em português (detectado: ${pageData.idioma}). A leitura em voz alta pode não funcionar como esperado.`,
                            [{ text: "OK" }]
                        );
                    }

                    const processedCount = await appendPageData(bookInfo.id_arquivo, pageData);

                    setProgress(prev => ({
                        ...prev,
                        [bookInfo.id_arquivo]: processedCount / bookInfo.total_paginas
                    }));

                    setTimeout(() => processPage(pageNumber + 1), 10);

                } else {
                    throw new Error(`Resposta inválida para a página ${pageNumber}.`);
                }

            } catch (error) {
                console.error(`Erro ao processar página ${pageNumber}:`, error);
                await updateBookStatus(bookInfo.id_arquivo, 'failed');
                delete processingControl[bookInfo.id_arquivo];
                loadBooksFromStorage();
            }
        };

        const existingPages = await loadBookPages(bookInfo.id_arquivo);
        const startPage = (existingPages?.length || 0) + 1;
        processPage(startPage);

    }, [loadBooksFromStorage]);

    useEffect(() => {
        const pendingBook = library.find(book => book.status === 'processing');
        if (pendingBook && !processingControl[pendingBook.id_arquivo]) {
            processBookPages(pendingBook);
        }
    }, [library, processBookPages]);

    const handleDocumentPick = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
            if (result.canceled) return;

            const file = result.assets[0];

            // --- NOVO: Verificação do tamanho do arquivo ---
            const MAX_FILE_SIZE_MB = 30;
            const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

            if (file.size > MAX_FILE_SIZE_BYTES) {
                Alert.alert(
                    "Arquivo Muito Grande",
                    `O arquivo selecionado tem mais de ${MAX_FILE_SIZE_MB} MB e não pode ser processado. Por favor, escolha um arquivo menor.`,
                    [{ text: "OK" }]
                );
                return; // Interrompe a execução
            }
            // --- FIM DA VERIFICAÇÃO ---

            setIsUploading(true);

            const formData = new FormData();
            formData.append('file', { uri: file.uri, name: file.name, type: 'application/pdf' });

            try {
                const response = await axios.post(`${API_BASE_URL}/iniciar_processamento`, formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                });

                const bookInfo = response.data;
                if (bookInfo.nome_original) {
                    bookInfo.nome_original = decodeURIComponent(bookInfo.nome_original);
                }
                const permanentUri = `${FileSystem.documentDirectory}${bookInfo.id_arquivo}`;
                await FileSystem.copyAsync({ from: file.uri, to: permanentUri });
                console.log(`PDF copiado para o armazenamento local: ${permanentUri}`);

                const bookToProcess = { ...bookInfo, localUri: permanentUri };
                await saveBook(bookToProcess);
                setProgress(prev => ({ ...prev, [bookInfo.id_arquivo]: 0 }));
                loadBooksFromStorage();
            } catch (error) {
                console.error("Erro ao escolher o documento:", error);
                Alert.alert("Erro", "Não foi possível iniciar o processamento do PDF. Tente novamente.");
            } finally {
                setIsUploading(false);
            }
        } catch (error) {
            console.error("Erro no DocumentPicker:", error);
            setIsUploading(false);
        }
    };

    const handlePressBook = async (item) => {
        if (isUploading) return;

        if (item.status === 'failed') {
            Alert.alert("Falha no Processamento", "Deseja tentar novamente?",
                [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                        text: 'Tentar Novamente', onPress: async () => {
                            await updateBookStatus(item.id_arquivo, 'processing');
                            loadBooksFromStorage();
                        }
                    },
                ]
            );
            return;
        }

        if (item.status === 'ready' || item.status === 'processing') {
            const pagesData = await loadBookPages(item.id_arquivo);
            if (pagesData && pagesData.length > 0) {
                navigation.navigate('Player', { bookInfo: { ...item, pagesData } });
            } else {
                Alert.alert("Aguarde um instante...", "O livro está sendo preparado. A primeira página estará disponível em breve.");
            }
        }
    };

    const handleRemoveBook = (bookId) => {
        Alert.alert("Remover Livro", "Deseja remover este livro da sua estante?",
            [
                { text: "Cancelar", style: "cancel" },
                {
                    text: "Remover", style: "destructive", onPress: async () => {
                        delete processingControl[bookId];
                        await removeBook(bookId);
                        setProgress(prev => {
                            const newProgress = { ...prev };
                            delete newProgress[bookId];
                            return newProgress;
                        });
                        loadBooksFromStorage();
                    }
                },
            ]
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <Modal transparent={true} animationType="fade" visible={isUploading}>
                <View style={styles.loadingOverlay}>
                    <View style={[styles.loadingContainer, { backgroundColor: colors.card }]}>
                        <ActivityIndicator size="large" color={colors.primary} />
                        <Text style={[styles.loadingTitle, { color: colors.text }]}>Enviando arquivo...</Text>
                        <Text style={[styles.loadingMessage, { color: colors.subtext }]}>
                            Isso pode levar alguns segundos.
                        </Text>
                    </View>
                </View>
            </Modal>
            <View style={styles.header}>
                <Image source={LogoApp} style={styles.logo} />
            </View>
            <FlatList
                data={library}
                keyExtractor={(item) => item.id_arquivo}
                numColumns={2}
                ListEmptyComponent={() => (
                    !isButtonDisabled && (
                        <View style={styles.emptyContainer}>
                            <Ionicons name="library-outline" size={64} color={colors.subtext} />
                            <Text style={[styles.emptyText, { color: colors.text }]}>A sua estante está vazia</Text>
                            <Text style={[styles.emptySubText, { color: colors.subtext }]}>Toque em '+' para adicionar um PDF e começar a ouvir.</Text>
                        </View>
                    )
                )}
                renderItem={({ item, index }) => {
                    const currentProgress = progress[item.id_arquivo] || 0;
                    return (
                        <TouchableOpacity
                            style={styles.bookItem}
                            onPress={() => handlePressBook(item)}
                            onLongPress={() => handleRemoveBook(item.id_arquivo)}
                            disabled={isUploading}
                        >
                            <View style={[styles.card, { backgroundColor: cardColors[index % cardColors.length] }]}>
                                {item.status === 'processing' ? (
                                    <View style={styles.centered}>
                                        <ActivityIndicator color="#fff" />
                                        <Text style={styles.progressText}>{(currentProgress * 100).toFixed(0)}%</Text>
                                    </View>
                                ) : item.status === 'failed' ? (
                                    <Ionicons name="alert-circle-outline" size={48} color="#fff" />
                                ) : (
                                    <Text style={styles.cardInitials}>{getInitials(item.nome_original)}</Text>
                                )}
                            </View>
                            <Text style={[styles.bookTitle, { color: colors.text }]} numberOfLines={2}>
                                {item.nome_original}
                            </Text>
                            {item.status === 'failed' && <Text style={{ color: '#E71D36' }}>Falhou</Text>}
                        </TouchableOpacity>
                    )
                }}
                contentContainerStyle={styles.listContainer}
            />
            <TouchableOpacity
                style={[styles.addButton, { backgroundColor: isButtonDisabled ? colors.subtext : colors.primary }]}
                onPress={handleDocumentPick}
                disabled={isButtonDisabled}
            >
                <Ionicons name="add" size={32} color="#fff" />
            </TouchableOpacity>
        </SafeAreaView>
    );
}

const { width } = Dimensions.get('window');
const cardSize = (width / 2) - 30;

const styles = StyleSheet.create({
    container: { flex: 1 },
    centered: { justifyContent: 'center', alignItems: 'center' },
    header: { paddingTop: 25, paddingBottom: 20, alignItems: 'center' },
    logo: { width: 120, height: 120, resizeMode: 'contain' },
    emptyContainer: { height: Dimensions.get('window').height * 0.6, justifyContent: 'center', alignItems: 'center', padding: 40 },
    emptyText: { fontSize: 18, fontWeight: 'bold', marginTop: 16, textAlign: 'center' },
    emptySubText: { fontSize: 15, marginTop: 8, textAlign: 'center' },
    listContainer: { paddingHorizontal: 10, paddingBottom: 80 },
    bookItem: { width: '50%', alignItems: 'center', marginBottom: 20, padding: 10 },
    card: {
        width: cardSize,
        height: cardSize,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 5,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
    },
    cardInitials: { fontSize: 48, fontWeight: 'bold', color: '#fff' },
    bookTitle: { marginTop: 10, fontSize: 14, fontWeight: '500', textAlign: 'center', width: cardSize },
    progressText: { color: '#fff', marginTop: 8, fontWeight: 'bold' },
    addButton: {
        position: 'absolute',
        bottom: 30,
        right: 20,
        width: 60,
        height: 60,
        borderRadius: 30,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 8,
    },
    loadingOverlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
    },
    loadingContainer: {
        width: '80%',
        padding: 25,
        borderRadius: 20,
        alignItems: 'center',
        elevation: 10,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 5 },
    },
    loadingTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginTop: 20,
        marginBottom: 10,
    },
    loadingMessage: {
        fontSize: 14,
        textAlign: 'center',
    },
});