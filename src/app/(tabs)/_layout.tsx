import { Tabs } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: '#58a6ff',
      tabBarInactiveTintColor: '#8b949e',
      tabBarStyle: { backgroundColor: '#161b22', borderTopColor: '#30363d' },
      headerStyle: { backgroundColor: '#161b22' },
      headerTintColor: '#f0f6fc',
    }}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: ({ color, size }) => <FontAwesome name="dashboard" color={typeof color === 'string' ? color : '#8b949e'} size={size} /> }} />
      <Tabs.Screen name="journal" options={{ title: 'Journal', tabBarIcon: ({ color, size }) => <FontAwesome name="book" color={typeof color === 'string' ? color : '#8b949e'} size={size} /> }} />
      <Tabs.Screen name="analytics" options={{ title: 'Analytics', tabBarIcon: ({ color, size }) => <FontAwesome name="bar-chart" color={typeof color === 'string' ? color : '#8b949e'} size={size} /> }} />
      <Tabs.Screen name="sessions" options={{ title: 'Sessions', tabBarIcon: ({ color, size }) => <FontAwesome name="clock-o" color={typeof color === 'string' ? color : '#8b949e'} size={size} /> }} />
      <Tabs.Screen name="coach" options={{ title: 'Coach', tabBarIcon: ({ color, size }) => <FontAwesome name="comment-o" color={typeof color === 'string' ? color : '#8b949e'} size={size} /> }} />
      <Tabs.Screen name="two" options={{ href: null }} />
    </Tabs>
  );
}
