import React, { useState, useContext } from 'react';
// --- INÍCIO DAS ALTERAÇÕES ---
// Adiciona os imports necessários para lidar com ficheiros e partilha
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, TextInput, ScrollView, Alert, ActivityIndicator } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
// --- FIM DAS ALTERAÇÕES ---
import { ThemeContext } from '../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import axios from 'axios';

const API_BASE_URL = 'https://willianqf-audio-transcriber.hf.space';

export default function VoiceToPdfScreen() {
    const { colors } = useContext(ThemeContext);
    const [recording, setRecording] = useState(null);
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [recognizedText, setRecognizedText] = useState('');
    const [statusMessage, setStatusMessage] = useState('Pressione o botão para iniciar a gravação.');

    const startRecording = async () => {
        try {
            const { status } = await Audio.requestPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permissão Negada', 'Precisamos da sua permissão para usar o microfone.');
                return;
            }

            await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
            setStatusMessage('A gravar...');
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HIGH_QUALITY
            );
            setRecording(recording);
            setIsRecording(true);
        } catch (err) {
            console.error('Falha ao iniciar a gravação', err);
            setStatusMessage('Erro ao iniciar a gravação.');
        }
    };

    const stopRecording = async () => {
        if (!recording) return;

        setIsRecording(false);
        setIsProcessing(true);
        setStatusMessage('A transcrever áudio, por favor aguarde...');

        try {
            await recording.stopAndUnloadAsync();
            const uri = recording.getURI();
            console.log('Gravação parada. Ficheiro em:', uri);
            await uploadAndTranscribeAudio(uri);
        } catch (error) {
            console.error("Erro ao parar e transcrever:", error);
            Alert.alert("Erro", "Ocorreu um erro ao finalizar a gravação.");
            setIsProcessing(false);
        }
        setRecording(null);
    };

    const uploadAndTranscribeAudio = async (fileUri) => {
        const formData = new FormData();
        formData.append('audio', {
            uri: fileUri,
            type: 'audio/m4a',
            name: `audio-${Date.now()}.m4a`,
        });

        try {
            const response = await axios.post(`${API_BASE_URL}/transcrever_audio`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            if (response.data && response.data.texto) {
                setRecognizedText(prevText => prevText ? `${prevText} ${response.data.texto}` : response.data.texto);
                setStatusMessage('Texto transcrito! Edite se necessário e gere o PDF.');
            } else {
                Alert.alert('Erro na Transcrição', response.data.erro || 'Não foi possível obter o texto do áudio.');
            }
        } catch (error) {
            console.error('Erro ao enviar o áudio:', error);
            Alert.alert('Erro de Rede', 'Não foi possível conectar ao servidor para transcrever.');
        } finally {
            setIsProcessing(false);
        }
    };

    // --- INÍCIO DA FUNÇÃO handleGeneratePdf CORRIGIDA ---
    const handleGeneratePdf = async () => {
        if (!recognizedText.trim()) {
            Alert.alert("Texto Vazio", "Não há texto para gerar um PDF.");
            return;
        }

        setIsProcessing(true);
        setStatusMessage('A gerar PDF...');

        try {
            // Usamos 'fetch' que é melhor para lidar com dados binários (ficheiros)
            const response = await fetch(`${API_BASE_URL}/gerar_pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ texto: recognizedText }),
            });

            // Verificamos se a resposta do servidor foi bem-sucedida
            if (!response.ok) {
                // Se o servidor enviou um erro, tentamos mostrar a mensagem
                const errorData = await response.json();
                throw new Error(errorData.erro || "Falha ao gerar o PDF no servidor.");
            }

            // Pega o conteúdo do ficheiro como um 'blob'
            const blob = await response.blob();

            // Define um nome único para o ficheiro
            const filename = `audioescrito_${Date.now()}.pdf`;
            // Define o local onde o ficheiro será guardado no telemóvel
            const fileUri = `${FileSystem.documentDirectory}${filename}`;

            // Converte o blob para base64 para o FileSystem poder guardá-lo
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = async () => {
                const base64data = reader.result;
                // Guarda o ficheiro no dispositivo
                await FileSystem.writeAsStringAsync(fileUri, base64data.split(',')[1], {
                    encoding: FileSystem.EncodingType.Base64,
                });

                console.log("PDF guardado em:", fileUri);
                setStatusMessage('PDF gerado! A abrir menu de partilha...');

                // Abre o menu de partilha do sistema operativo
                if (await Sharing.isAvailableAsync()) {
                    await Sharing.shareAsync(fileUri);
                } else {
                    Alert.alert("Partilha não disponível", "Não é possível abrir o menu de partilha neste dispositivo.");
                }
                // Limpa o estado após a partilha
                setIsProcessing(false);
                setStatusMessage('Pressione o botão para iniciar uma nova gravação.');
            };

        } catch (error) {
            console.error("Erro ao gerar PDF:", error);
            Alert.alert("Erro", error.message || "Não foi possível conectar ao servidor para gerar o PDF.");
            setIsProcessing(false);
            setStatusMessage('Pressione o botão para iniciar uma nova gravação.');
        }
    };
    // --- FIM DA FUNÇÃO handleGeneratePdf CORRIGIDA ---


    const handleMicPress = () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>AudioEscrito para PDF</Text>

            <ScrollView style={styles.textInputContainer}>
                <TextInput
                    style={[styles.textInput, { color: colors.text, opacity: isProcessing ? 0.5 : 1 }]}
                    multiline
                    value={recognizedText}
                    onChangeText={setRecognizedText}
                    placeholder="O seu texto transcrito aparecerá aqui..."
                    placeholderTextColor={colors.subtext}
                    editable={!isProcessing && !isRecording}
                />
            </ScrollView>

            <Text style={[styles.statusText, { color: colors.subtext }]}>{statusMessage}</Text>

            <View style={styles.footer}>
                <TouchableOpacity onPress={() => setRecognizedText('')} disabled={isRecording || isProcessing} style={styles.actionButton}>
                    <Ionicons name="trash-outline" size={30} color={isRecording || isProcessing ? colors.subtext : colors.text} />
                </TouchableOpacity>

                <TouchableOpacity
                    onPress={handleMicPress}
                    disabled={isProcessing}
                    style={[styles.micButton, { backgroundColor: isRecording ? '#E71D36' : colors.primary }]}
                >
                    {isProcessing ? (
                        <ActivityIndicator size="large" color="#fff" />
                    ) : (
                        <Ionicons name={isRecording ? "stop-circle-outline" : "mic-outline"} size={48} color="#fff" />
                    )}
                </TouchableOpacity>

                <TouchableOpacity onPress={handleGeneratePdf} disabled={isRecording || isProcessing} style={styles.actionButton}>
                    <Ionicons name="document-text-outline" size={30} color={isRecording || isProcessing ? colors.subtext : colors.text} />
                </TouchableOpacity>
            </View>
        </SafeAreaView>
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
        paddingTop: 20,
        paddingBottom: 10,
    },
    textInputContainer: {
        flex: 1,
        marginHorizontal: 20,
        marginTop: 10,
        borderWidth: 1,
        borderColor: '#ccc',
        borderRadius: 10,
    },
    textInput: {
        flex: 1,
        padding: 15,
        fontSize: 16,
        textAlignVertical: 'top',
        minHeight: 150,
    },
    statusText: {
        textAlign: 'center',
        marginVertical: 15,
        paddingHorizontal: 20,
        fontSize: 14,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderTopWidth: 1,
        borderTopColor: '#eee'
    },
    micButton: {
        width: 80,
        height: 80,
        borderRadius: 40,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 8,
    },
    actionButton: {
        width: 60,
        height: 60,
        justifyContent: 'center',
        alignItems: 'center',
    },
});