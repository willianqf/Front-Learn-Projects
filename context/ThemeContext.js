// /Front-and/context/ThemeContext.js

import React, { createContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';

const lightColors = {
  background: '#f4f6f8',
  card: '#ffffff',
  text: '#111',
  subtext: '#666',
  primary: '#007bff',
  icon: 'gray',
  activeIcon: '#007bff',
  statusBar: 'dark-content',
};

const darkColors = {
  background: '#1e1e1e',
  card: '#333',
  text: '#fff',
  subtext: '#aaa',
  primary: '#007bff',
  icon: 'gray',
  activeIcon: '#007bff',
  statusBar: 'light-content',
};

// ### CORREÇÃO AQUI ###
// Damos um valor inicial para o contexto para evitar erros de 'undefined' durante a inicialização.
export const ThemeContext = createContext({
  theme: 'light',
  colors: lightColors,
  toggleTheme: () => {}, // Uma função vazia como padrão
});

// O resto do arquivo permanece o mesmo
export const ThemeProvider = ({ children }) => {
  const systemTheme = useColorScheme();
  const [theme, setTheme] = useState(systemTheme || 'light'); // Garante que nunca seja nulo

  useEffect(() => {
    const loadTheme = async () => {
      const savedTheme = await AsyncStorage.getItem('@theme');
      if (savedTheme) {
        setTheme(savedTheme);
      }
    };
    loadTheme();
  }, []);

  const toggleTheme = async () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    await AsyncStorage.setItem('@theme', newTheme);
  };

  const colors = theme === 'light' ? lightColors : darkColors;

  return (
    <ThemeContext.Provider value={{ theme, colors, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};