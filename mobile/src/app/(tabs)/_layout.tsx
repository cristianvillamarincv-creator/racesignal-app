import { Tabs, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, Text, type ColorValue } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { athlete } from '@/fixtures/athlete';
import { colors } from '@/lib/theme';

function HeaderAvatarButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/settings')}
      accessibilityRole="button"
      accessibilityLabel="Open profile and settings"
      hitSlop={8}
      style={{ marginRight: 16, minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
      <Avatar initials={athlete.avatarInitials} />
    </Pressable>
  );
}

function TabIcon({
  name,
  color,
}: {
  name: Parameters<typeof SymbolView>[0]['name'];
  color: ColorValue;
}) {
  return (
    <SymbolView
      name={name}
      size={24}
      tintColor={color}
      fallback={<Text style={{ color, fontSize: 20 }}>•</Text>}
    />
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerRight: () => <HeaderAvatarButton />,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Signal',
          tabBarIcon: ({ color }) => (
            <TabIcon name="antenna.radiowaves.left.and.right" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="season"
        options={{
          title: 'Season',
          tabBarIcon: ({ color }) => <TabIcon name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="medals"
        options={{
          title: 'Medals',
          tabBarIcon: ({ color }) => <TabIcon name="rosette" color={color} />,
        }}
      />
      <Tabs.Screen
        name="ask"
        options={{
          title: 'Ask',
          tabBarIcon: ({ color }) => <TabIcon name="sparkles" color={color} />,
        }}
      />
    </Tabs>
  );
}
