// /Front-and/utils/libraryManager.js

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const LIBRARY_KEY = '@HearLearn:library';
const BOOK_DATA_PREFIX = '@HearLearn:book_data_';

// Função para obter o caminho do arquivo de dados de um livro
const getBookDataPath = (bookId) => `${FileSystem.documentDirectory}book-data/${bookId}.json`;

// Carrega apenas os metadados dos livros da lista principal
export const loadLibrary = async () => {
    try {
        const jsonValue = await AsyncStorage.getItem(LIBRARY_KEY);
        return jsonValue != null ? JSON.parse(jsonValue) : [];
    } catch (e) {
        console.error("Erro ao carregar a biblioteca.", e);
        return [];
    }
};

// Salva a lista de metadados dos livros
const saveLibrary = async (library) => {
    const jsonValue = JSON.stringify(library);
    await AsyncStorage.setItem(LIBRARY_KEY, jsonValue);
}

// Carrega os dados das páginas de um livro específico a partir do seu arquivo
export const loadBookPages = async (bookId) => {
    const filePath = getBookDataPath(bookId);
    try {
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        if (fileInfo.exists) {
            const content = await FileSystem.readAsStringAsync(filePath);
            return JSON.parse(content);
        }
        return null;
    } catch (e) {
        console.error(`Erro ao carregar páginas do livro ${bookId}:`, e);
        return null;
    }
};

// Salva um livro: metadados na lista principal, dados das páginas em arquivo separado
export const saveBook = async (bookData) => {
    try {
        let library = await loadLibrary();
        const { pagesData, ...bookMetadata } = bookData;

        // Garante que o diretório para os dados dos livros exista
        await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}book-data/`, { intermediates: true });

        // Salva os dados das páginas em um arquivo JSON separado
        if (pagesData) {
            const filePath = getBookDataPath(bookMetadata.id_arquivo);
            await FileSystem.writeAsStringAsync(filePath, JSON.stringify(pagesData));
        }

        const bookIndex = library.findIndex(book => book.id_arquivo === bookMetadata.id_arquivo);

        if (bookIndex !== -1) {
            library[bookIndex] = { ...library[bookIndex], ...bookMetadata };
        } else {
            const newBook = {
                ...bookMetadata,
                status: bookMetadata.status || 'ready',
                lastPosition: 0,
                listeningTime: 0,
                completed: false,
                bookmarks: [],
                annotations: {},
            };
            library.push(newBook);
        }

        await saveLibrary(library);
    } catch (e) {
        console.error("Erro ao salvar o livro.", e);
    }
};

// Remove o livro da lista e também seus arquivos de dados e PDF
export const removeBook = async (bookId) => {
    try {
        let library = await loadLibrary();
        const bookToRemove = library.find(book => book.id_arquivo === bookId);

        // Remove da lista
        const newLibrary = library.filter(book => book.id_arquivo !== bookId);
        await saveLibrary(newLibrary);

        // Remove o arquivo de dados JSON
        const dataPath = getBookDataPath(bookId);
        await FileSystem.deleteAsync(dataPath, { idempotent: true });
        console.log(`Dados do livro removidos: ${dataPath}`);

        // Remove o arquivo PDF local
        if (bookToRemove?.localUri) {
            await FileSystem.deleteAsync(bookToRemove.localUri, { idempotent: true });
            console.log(`Arquivo PDF local removido: ${bookToRemove.localUri}`);
        }

    } catch (e) {
        console.error("Erro ao remover o livro.", e);
    }
};


// As funções abaixo (updateBookState, bookmarks, annotations) modificam
// os metadados do livro, então elas operam na lista principal da biblioteca.
// Não precisam de grandes alterações.

export const updateBookState = async (bookId, pageIndex, timeIncrement) => {
    try {
        const library = await loadLibrary();
        const newLibrary = library.map(book => {
            if (book.id_arquivo === bookId) {
                const isCompleted = pageIndex >= book.total_paginas - 1;
                return {
                    ...book,
                    lastPosition: pageIndex,
                    listeningTime: (book.listeningTime || 0) + timeIncrement,
                    completed: book.completed || isCompleted,
                };
            }
            return book;
        });
        await saveLibrary(newLibrary);
    } catch (e) {
        console.error("Erro ao atualizar o estado do livro.", e);
    }
};

export const addBookmark = async (bookId, pageIndex) => {
    try {
        const library = await loadLibrary();
        const newLibrary = library.map(book => {
            if (book.id_arquivo === bookId) {
                const bookmarks = book.bookmarks || [];
                if (!bookmarks.includes(pageIndex)) {
                    return { ...book, bookmarks: [...bookmarks, pageIndex].sort((a, b) => a - b) };
                }
            }
            return book;
        });
        await saveLibrary(newLibrary);
    } catch (e) {
        console.error("Erro ao adicionar o marcador.", e);
    }
};

export const removeBookmark = async (bookId, pageIndex) => {
    try {
        const library = await loadLibrary();
        const newLibrary = library.map(book => {
            if (book.id_arquivo === bookId) {
                const bookmarks = book.bookmarks || [];
                return { ...book, bookmarks: bookmarks.filter(p => p !== pageIndex) };
            }
            return book;
        });
        await saveLibrary(newLibrary);
    } catch (e) {
        console.error("Erro ao remover o marcador.", e);
    }
};

export const saveAnnotation = async (bookId, pageIndex, text) => {
    try {
        const library = await loadLibrary();
        const newLibrary = library.map(book => {
            if (book.id_arquivo === bookId) {
                const annotations = book.annotations || {};
                annotations[pageIndex] = text;
                return { ...book, annotations };
            }
            return book;
        });
        await saveLibrary(newLibrary);
    } catch (e) {
        console.error("Erro ao salvar anotação.", e);
    }
};

export const removeAnnotation = async (bookId, pageIndex) => {
    try {
        const library = await loadLibrary();
        const newLibrary = library.map(book => {
            if (book.id_arquivo === bookId) {
                const annotations = book.annotations || {};
                delete annotations[pageIndex];
                return { ...book, annotations };
            }
            return book;
        });
        await saveLibrary(newLibrary);
    } catch (e) {
        console.error("Erro ao remover anotação.", e);
    }
};