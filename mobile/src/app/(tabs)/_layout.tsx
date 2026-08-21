import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { Pressable, type ColorValue } from 'react-native';

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
  filledName,
  outlineName,
  color,
  focused,
}: {
  filledName: keyof typeof Ionicons.glyphMap;
  outlineName: keyof typeof Ionicons.glyphMap;
  color: ColorValue;
  focused: boolean;
}) {
  return <Ionicons name={focused ? filledName : outlineName} size={24} color={color} />;
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
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon filledName="home" outlineName="home-outline" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="season"
        options={{
          title: 'Season',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              filledName="calendar"
              outlineName="calendar-outline"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Stats',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon filledName="trophy" outlineName="trophy-outline" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="ask"
        options={{
          title: 'Ask',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              filledName="sparkles"
              outlineName="sparkles-outline"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
    </Tabs>
  );
}
