// /Front-and/utils/libraryManager.js

import AsyncStorage from '@react-native-async-storage/async-storage';

const LIBRARY_KEY = '@HearLearn:library';

export const loadLibrary = async () => {
  try {
    const jsonValue = await AsyncStorage.getItem(LIBRARY_KEY);
    return jsonValue != null ? JSON.parse(jsonValue) : [];
  } catch (e) {
    console.error("Erro ao carregar a biblioteca.", e);
    return [];
  }
};

export const saveBook = async (bookData) => {
  try {
    let library = await loadLibrary();
    const bookIndex = library.findIndex(book => book.id_arquivo === bookData.id_arquivo);

    if (bookIndex !== -1) {
      library[bookIndex] = { ...library[bookIndex], ...bookData };
    } else {
      // MODIFICAÇÃO: Adicionamos os campos para estatísticas
      const newBook = {
        ...bookData,
        status: bookData.status || 'ready',
        lastPosition: 0,
        listeningTime: 0, // NOVO: Tempo de audição em segundos
        completed: false,   // NOVO: Indica se o livro foi concluído
        bookmarks: [],
        annotations: {},
      };
      library.push(newBook);
    }

    const jsonValue = JSON.stringify(library);
    await AsyncStorage.setItem(LIBRARY_KEY, jsonValue);
  } catch (e) {
    console.error("Erro ao salvar o livro.", e);
  }
};

// MODIFICADO: Esta função agora atualiza o progresso, o tempo de audição e o estado de conclusão.
// A antiga 'updateBookProgress' foi substituída por esta.
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
        const jsonValue = JSON.stringify(newLibrary);
        await AsyncStorage.setItem(LIBRARY_KEY, jsonValue);
    } catch (e) {
        console.error("Erro ao atualizar o estado do livro.", e);
    }
};

export const removeBook = async (bookId) => {
    try {
        const library = await loadLibrary();
        const newLibrary = library.filter(book => book.id_arquivo !== bookId);
        const jsonValue = JSON.stringify(newLibrary);
        await AsyncStorage.setItem(LIBRARY_KEY, jsonValue);
    } catch (e) {
        console.error("Erro ao remover o livro.", e);
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
        const jsonValue = JSON.stringify(newLibrary);
        await AsyncStorage.setItem(LIBRARY_KEY, jsonValue);
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
        const jsonValue = JSON.stringify(newLibrary);
        await AsyncStorage.setItem(LIBRARY_KEY, jsonValue);
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
        const jsonValue = JSON.stringify(newLibrary);
        await AsyncStorage.setItem(LIBRARY_KEY, jsonValue);
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
        const jsonValue = JSON.stringify(newLibrary);
        await AsyncStorage.setItem(LIBRARY_KEY, jsonValue);
    } catch (e) {
        console.error("Erro ao remover anotação.", e);
    }
};


export const clearLibrary = async () => {
    try {
        await AsyncStorage.removeItem(LIBRARY_KEY);
    } catch (e) {
        console.error("Erro ao limpar a biblioteca.", e);
    }
};