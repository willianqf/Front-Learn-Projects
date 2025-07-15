import React, { useContext } from 'react'; // 1. Importamos useContext
import { View, Text, StyleSheet, Image } from 'react-native';
import { ThemeContext } from '../context/ThemeContext'; // 2. Importamos nosso contexto
import LogoApp from '../image/IconApp.png';

export default function AboutScreen() {
  // 3. Usamos o hook para pegar as cores do tema
  const { colors } = useContext(ThemeContext);

  // 4. Os estilos agora são criados dentro do componente
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background, // Usa a cor do tema
      padding: 20,
    },
    logo: {
      width: 120,
      height: 120,
      marginBottom: 20,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: colors.text, // Usa a cor do tema
    },
    subtitle: {
      fontSize: 16,
      color: colors.subtext, // Usa a cor do tema
      marginBottom: 30,
    },
    description: {
      fontSize: 16,
      color: colors.text, // Usa a cor do tema
      textAlign: 'center',
      marginBottom: 10,
    },
  });

  return (
    <View style={styles.container}>
      <Image source={LogoApp} style={styles.logo} />
      <Text style={styles.title}>HearLearn</Text>
      <Text style={styles.subtitle}>Versão 1.0.0</Text>
      <Text style={styles.description}>
        Desenvolvido com paixão por Willian Quirino.
      </Text>
      <Text style={styles.description}>
        Transformando leitura em audição, uma página de cada vez.
      </Text>
    </View>
  );
}