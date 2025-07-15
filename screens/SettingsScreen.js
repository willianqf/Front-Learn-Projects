// /Front-and/screens/SettingsScreen.js

import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Switch } from 'react-native';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeContext } from '../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';

const VOICE_PREFERENCE_KEY = '@HearLearn:voicePreference';

export default function SettingsScreen() {
    const { colors, theme, toggleTheme } = useContext(ThemeContext);
    const isDarkTheme = theme === 'dark';

    const [availableVoices, setAvailableVoices] = useState([]);
    const [selectedVoiceIdentifier, setSelectedVoiceIdentifier] = useState(null);

    // Carrega as vozes e a preferência guardada ao iniciar a tela
    useEffect(() => {
        const loadSettings = async () => {
            const voices = await Speech.getAvailableVoicesAsync();
            const ptBrVoices = voices.filter(v => v.language.startsWith('pt-BR'));
            setAvailableVoices(ptBrVoices);

            const savedVoice = await AsyncStorage.getItem(VOICE_PREFERENCE_KEY);
            if (savedVoice) {
                setSelectedVoiceIdentifier(savedVoice);
            } else if (ptBrVoices.length > 0) {
                setSelectedVoiceIdentifier(ptBrVoices[0].identifier);
            }
        };

        loadSettings();
    }, []);

    // Função para guardar a nova preferência de voz
    const handleSelectVoice = async (voiceIdentifier) => {
        try {
            await AsyncStorage.setItem(VOICE_PREFERENCE_KEY, voiceIdentifier);
            setSelectedVoiceIdentifier(voiceIdentifier);
        } catch (e) {
            console.error("Erro ao guardar a preferência de voz.", e);
            Alert.alert("Erro", "Não foi possível guardar a sua preferência.");
        }
    };

    // Função para mostrar o menu de seleção de vozes
    const showVoiceSelector = () => {
        if (availableVoices.length === 0) {
            Alert.alert("Sem Vozes", "Nenhuma voz adicional em Português (BR) foi encontrada neste dispositivo.");
            return;
        }

        const voiceOptions = availableVoices.map(voice => ({
            text: voice.name,
            onPress: () => handleSelectVoice(voice.identifier)
        }));

        Alert.alert(
            "Escolher Voz",
            "Selecione uma das vozes disponíveis:",
            [...voiceOptions, { text: "Cancelar", style: "cancel" }],
            { cancelable: true }
        );
    };

    const getSelectedVoiceName = () => {
        const voice = availableVoices.find(v => v.identifier === selectedVoiceIdentifier);
        return voice ? voice.name : "Padrão";
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
             <Text style={[styles.headerTitle, { color: colors.text }]}>Configurações</Text>
            <ScrollView>
                {/* Cartão de Aparência */}
                <View style={[styles.card, { backgroundColor: colors.card }]}>
                    <View style={styles.cardHeader}>
                        <Ionicons name="color-palette-outline" size={22} color={colors.subtext} />
                        <Text style={[styles.cardTitle, { color: colors.subtext }]}>APARÊNCIA</Text>
                    </View>
                    <View style={styles.optionRow}>
                        <Text style={[styles.optionText, { color: colors.text }]}>Tema Escuro</Text>
                        <Switch
                          trackColor={{ false: "#767577", true: colors.primary }}
                          thumbColor={isDarkTheme ? "#f4f3f4" : "#f4f3f4"}
                          onValueChange={toggleTheme}
                          value={isDarkTheme}
                        />
                    </View>
                </View>

                {/* Cartão de Voz */}
                <View style={[styles.card, { backgroundColor: colors.card }]}>
                    <View style={styles.cardHeader}>
                        <Ionicons name="volume-medium-outline" size={22} color={colors.subtext} />
                        <Text style={[styles.cardTitle, { color: colors.subtext }]}>LEITURA</Text>
                    </View>
                    <TouchableOpacity style={styles.optionRow} onPress={showVoiceSelector}>
                        <Text style={[styles.optionText, { color: colors.text }]}>Voz</Text>
                        <View style={styles.valueContainer}>
                           <Text style={[styles.valueText, { color: colors.primary }]}>{getSelectedVoiceName()}</Text>
                           <Ionicons name="chevron-forward" size={20} color={colors.subtext} />
                        </View>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 34,
        fontWeight: 'bold',
        paddingHorizontal: 20,
        paddingTop: 70,
        paddingBottom: 20,
    },
    card: {
        marginHorizontal: 15,
        marginBottom: 20,
        borderRadius: 12,
        paddingHorizontal: 15,
        elevation: 1,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 0 },
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 20,
        paddingBottom: 10,
    },
    cardTitle: {
        marginLeft: 10,
        fontSize: 13,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    optionRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 15,
        borderTopWidth: 1,
        borderTopColor: '#eee', // Usaremos uma cor mais clara, que se adapta bem a ambos os temas
    },
    optionText: {
        fontSize: 17,
    },
    valueContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    valueText: {
        fontSize: 17,
        marginRight: 5,
    },
});
