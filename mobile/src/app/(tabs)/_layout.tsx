import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { ActionSheetIOS, Pressable, View, type ColorValue } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { RaceFilterProvider, useRaceFilter } from '@/lib/raceFilterContext';
import { useAthleteRaces } from '@/lib/racesContext';
import { colors } from '@/lib/theme';

/**
 * The one global entry point for adding a race, reachable from every tab (P0-7) — not a tab-bar
 * redesign, just a header affordance next to the existing avatar button. Order matches what's most
 * useful most often: most athletes have existing public results to recover before they'd type one
 * in by hand, and an upcoming race (which drives the Races tab's countdown) is a more common ad-hoc
 * action than backfilling a historical result manually.
 */
function HeaderAddButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['Find past races', 'Add upcoming race', 'Add manually', 'Cancel'],
            cancelButtonIndex: 3,
          },
          (index) => {
            if (index === 0) router.push('/find-races');
            else if (index === 1) router.push('/race/add?mode=upcoming');
            else if (index === 2) router.push('/race/add?mode=completed');
          },
        );
      }}
      accessibilityRole="button"
      accessibilityLabel="Add a race"
      hitSlop={8}
      style={{ marginLeft: 16, minWidth: 44, minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' }}>
      <Ionicons name="add-circle-outline" size={28} color={colors.accent} />
    </Pressable>
  );
}

function initialsFor(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/**
 * The one global entry point for race-name search, reachable from every tab — Stats stays
 * analytics-focused with no second search field of its own (P1). Jumps to the Races tab and
 * requests focus on its existing (local-only) search field via the shared race-filter context,
 * rather than duplicating search state/UI anywhere else.
 */
function HeaderSearchButton() {
  const router = useRouter();
  const { requestSearchFocus } = useRaceFilter();
  return (
    <Pressable
      onPress={() => {
        requestSearchFocus();
        router.push('/');
      }}
      accessibilityRole="button"
      accessibilityLabel="Search races by name"
      hitSlop={8}
      style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="search-outline" size={22} color={colors.textSecondary} />
    </Pressable>
  );
}

function HeaderAvatarButton() {
  const router = useRouter();
  const { racingName } = useAthleteRaces();
  return (
    <Pressable
      onPress={() => router.push('/settings')}
      accessibilityRole="button"
      accessibilityLabel="Open profile and settings"
      hitSlop={8}
      style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
      <Avatar initials={initialsFor(racingName)} />
    </Pressable>
  );
}

function HeaderRightGroup() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12, gap: 4 }}>
      <HeaderSearchButton />
      <HeaderAvatarButton />
    </View>
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
    <RaceFilterProvider>
      <TabsNavigator />
    </RaceFilterProvider>
  );
}

function TabsNavigator() {
  return (
    <Tabs
      screenOptions={{
        headerLeft: () => <HeaderAddButton />,
        headerRight: () => <HeaderRightGroup />,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Races',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon filledName="flag" outlineName="flag-outline" color={color} focused={focused} />
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
          title: 'AI',
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
