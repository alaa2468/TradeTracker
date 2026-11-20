import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import CryptoMarketPanel from '@/components/CryptoMarketPanel';
import { DailyMarketPanel } from '@/components/DailyMarketPanel';
import { ui } from '@/components/TradingUI';

export default function TradingAgentScreen() {
  const [category, setCategory] = useState<'Crypto' | 'Gold' | 'Forex'>('Crypto');
  return <View style={ui.page}>
    <View style={{ padding: 16, paddingBottom: 0 }}>
      <Text style={ui.title}>Market category</Text>
      <View style={[ui.actions, { paddingVertical: 10 }]}>
        {(['Crypto', 'Gold', 'Forex'] as const).map(value => <TouchableOpacity key={value}
          accessibilityRole="button" accessibilityState={{ selected: category === value }}
          style={[ui.button, category !== value && ui.secondary]} onPress={() => setCategory(value)}>
          <Text style={ui.buttonText}>{value}</Text>
        </TouchableOpacity>)}
      </View>
    </View>
    {category === 'Crypto' ? <CryptoMarketPanel /> : <DailyMarketPanel key={category} category={category} />}
  </View>;
}
