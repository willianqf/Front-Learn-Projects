import React, { useState, useCallback, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, SafeAreaView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { loadLibrary } from '../utils/libraryManager';

// Função para formatar o tempo de segundos para um formato legível (ex: 1h 15m 30s)
const formatTime = (totalSeconds) => {
    if (totalSeconds === 0) return '0s';

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    let timeString = '';
    if (hours > 0) timeString += `${hours}h `;
    if (minutes > 0 || hours > 0) timeString += `${minutes}m `;
    if (seconds > 0 || (hours === 0 && minutes === 0)) timeString += `${seconds}s`;

    return timeString.trim();
};

// Componente reutilizável para cada cartão de estatística
const StatCard = ({ icon, title, value, color, colors }) => (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Ionicons name={icon} size={32} color={color} />
        <Text style={[styles.cardValue, { color: colors.text }]}>{value}</Text>
        <Text style={[styles.cardTitle, { color: colors.subtext }]}>{title}</Text>
    </View>
);

export default function StatsScreen() {
    const { colors } = useContext(ThemeContext);
    const [stats, setStats] = useState({
        totalListeningTime: 0,
        completedBooks: 0,
        totalPagesRead: 0,
        totalBooks: 0,
    });
    const [refreshing, setRefreshing] = useState(false);

    // Função para carregar a biblioteca e calcular as estatísticas
    const calculateStats = useCallback(async () => {
        setRefreshing(true);
        const library = await loadLibrary();
        
        const totalListeningTime = library.reduce((acc, book) => acc + (book.listeningTime || 0), 0);
        const completedBooks = library.filter(book => book.completed).length;
        const totalPagesRead = library.reduce((acc, book) => acc + (book.lastPosition || 0), 0);

        setStats({
            totalListeningTime,
            completedBooks,
            totalPagesRead,
            totalBooks: library.length,
        });
        setRefreshing(false);
    }, []);

    // useFocusEffect garante que as estatísticas são atualizadas sempre que o ecrã é focado
    useFocusEffect(
        useCallback(() => {
            calculateStats();
        }, [calculateStats])
    );

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <ScrollView 
                contentContainerStyle={styles.scrollViewContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={calculateStats} tintColor={colors.primary} />
                }
            >
                <Text style={[styles.headerTitle, { color: colors.text }]}>Estatísticas</Text>

                <View style={styles.cardsContainer}>
                    <StatCard 
                        icon="time" 
                        title="Tempo de Audição" 
                        value={formatTime(stats.totalListeningTime)}
                        color="#4CAF50"
                        colors={colors}
                    />
                    <StatCard 
                        icon="checkmark-done-circle" 
                        title="Livros Concluídos" 
                        value={stats.completedBooks}
                        color="#2196F3"
                        colors={colors}
                    />
                    <StatCard 
                        icon="library" 
                        title="Total de Livros" 
                        value={stats.totalBooks}
                        color="#FFC107"
                        colors={colors}
                    />
                    <StatCard 
                        icon="reader" 
                        title="Páginas Lidas" 
                        value={stats.totalPagesRead}
                        color="#E91E63"
                        colors={colors}
                    />
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollViewContent: {
        paddingBottom: 20,
    },
    headerTitle: {
        fontSize: 34,
        fontWeight: 'bold',
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 20,
    },
    cardsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        paddingHorizontal: 10,
    },
    card: {
        width: '45%',
        aspectRatio: 1, // Mantém o cartão quadrado
        margin: '2.5%',
        borderRadius: 15,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 15,
        elevation: 3,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
    },
    cardValue: {
        fontSize: 28,
        fontWeight: 'bold',
        marginTop: 10,
        textAlign: 'center',
    },
    cardTitle: {
        fontSize: 14,
        fontWeight: '500',
        marginTop: 5,
        textAlign: 'center',
    },
});