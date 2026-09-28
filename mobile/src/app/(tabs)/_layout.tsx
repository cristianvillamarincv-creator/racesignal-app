import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AddRaceSheet, type AddRaceChoice } from '@/components/AddRaceSheet';
import { Avatar } from '@/components/Avatar';
import { SignalMark } from '@/components/SignalMark';
import { TabIconImage } from '@/components/TabIconImage';
import { useBrandPalette } from '@/lib/brandTheme';
import { RaceFilterProvider, useRaceFilter } from '@/lib/raceFilterContext';
import { useAthleteRaces } from '@/lib/racesContext';

/**
 * The one global entry point for adding a race, reachable from every tab (P0-7) — not a tab-bar
 * redesign, just a header affordance next to the existing avatar button. Order matches what's most
 * useful most often: most athletes have existing public results to recover before they'd type one
 * in by hand, and an upcoming race (which drives the Races tab's countdown) is a more common ad-hoc
 * action than backfilling a historical result manually. Opens the brand-themed `AddRaceSheet`
 * (owned by the caller, `TabsNavigator`) rather than the native `ActionSheetIOS` chooser.
 */
function HeaderAddButton({ onPress }: { onPress: () => void }) {
  const palette = useBrandPalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Add a race"
      hitSlop={8}
      style={{ marginLeft: 16, minWidth: 44, minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' }}>
      {/* A plain plus, not the circled variant — paired with search-outline's bare-glyph weight
          rather than adding a second circular shape next to the profile avatar. */}
      <Ionicons name="add" size={26} color={palette.signalBlue} />
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
  const palette = useBrandPalette();
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
      <Ionicons name="search-outline" size={22} color={palette.inkSecondary} />
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

/**
 * B.14: the `<Tabs initialRouteName="stats">` prop below (already set, see its own comment) only
 * governs React Navigation's tab-focus state AFTER this navigator has already mounted — it does
 * NOT affect expo-router's own route resolution when `(tabs)` is entered fresh with no more
 * specific path requested (e.g. RootNavigator's `<Stack.Screen name="(tabs)" />` in _layout.tsx,
 * reached the moment onboarding's phase flips to 'app'). For THAT — confirmed via expo-router
 * 6.0.24's own source (packages/expo-router/build/getRoutesCore.js) and its docs — the router reads
 * `unstable_settings.initialRouteName` exported from this file. Without it, the group's file-system
 * "index" route (this app's Races tab, since that screen happens to live at index.tsx) wins by
 * convention regardless of the Tabs prop or visual tab order, which is exactly the confirmed device
 * report: a normal launch opened Races even with tab order and the Tabs prop already correct. This
 * only affects a cold entry into the group with no path already requested — an explicit navigation
 * (e.g. HeaderSearchButton's `router.push('/')` to reach Races on purpose) still wins, and switching
 * tabs afterward is untouched.
 */
export const unstable_settings = {
  initialRouteName: 'stats',
};

export default function TabsLayout() {
  return (
    <RaceFilterProvider>
      <TabsNavigator />
    </RaceFilterProvider>
  );
}

function TabsNavigator() {
  const palette = useBrandPalette();
  const router = useRouter();
  const [isAddSheetVisible, setAddSheetVisible] = useState(false);

  function handleAddRaceSelect(choice: AddRaceChoice) {
    setAddSheetVisible(false);
    if (choice === 'find') router.push('/find-races');
    else if (choice === 'upcoming') router.push('/race/add?mode=upcoming');
    else if (choice === 'manual') router.push('/race/add?mode=completed');
  }

  return (
    <>
      <Tabs
        // Stats → Races → Signal (Build 11 nav-order instruction). `initialRouteName` is what
        // actually governs which tab is ACTIVE the moment this navigator mounts fresh — after
        // onboarding completes (RootNavigator's phase flip from 'onboarding' to 'app' in
        // _layout.tsx) and on a normal cold launch of an already-onboarded athlete, both land here
        // with no more specific nested path requested, so both correctly default to Stats. This is
        // independent of, and does not touch, any EXPLICIT navigation elsewhere that already
        // targets a specific tab on purpose — e.g. HeaderSearchButton's `router.push('/')` (jumps
        // to Races specifically because only Races has the search field) — those keep working
        // exactly as before, since initialRouteName only affects the no-path-yet-requested case.
        initialRouteName="stats"
        screenOptions={{
          headerLeft: () => <HeaderAddButton onPress={() => setAddSheetVisible(true)} />,
          headerRight: () => <HeaderRightGroup />,
          tabBarActiveTintColor: palette.signalBlue,
          tabBarInactiveTintColor: palette.inkSecondary,
          tabBarStyle: { backgroundColor: palette.headerBackground, borderTopColor: palette.hairline },
          headerStyle: { backgroundColor: palette.headerBackground },
          headerTintColor: palette.ink,
        }}>
        <Tabs.Screen
          name="stats"
          options={{
            title: 'Stats',
            // Optical sizing only — the supplied glyph itself is unchanged, this just carries
            // similar visual weight to the Races icon (22px) and the Signal mark (22px).
            tabBarIcon: ({ color }) => <TabIconImage source={require('../../assets/stats-tab-icon.png')} color={color} size={24} />,
          }}
        />
        <Tabs.Screen
          name="index"
          options={{
            title: 'Races',
            // Final supplied production glyph (mobile/src/assets/races-tab-icon.png), tinted the
            // same way as the Signal tab's own mark — size matches SignalMark's 22px so none of the
            // three tab icons visually dominates the others.
            tabBarIcon: ({ color }) => <TabIconImage source={require('../../assets/races-tab-icon.png')} color={color} size={22} />,
          }}
        />
        <Tabs.Screen
          name="ask"
          options={{
            title: 'Signal',
            // The app's own proprietary Signal mark, not a generic AI-sparkle glyph — this is the
            // single most persistent "AI chatbot" tell in the app's chrome, so it uses the same mark
            // as the Signal module and app icon rather than an icon-library symbol.
            tabBarIcon: ({ color }) => <SignalMark color={color} size={22} />,
          }}
        />
      </Tabs>
      {/* Rendered as a sibling of the Tabs navigator (not inside a single screen) so it can present
          on top of whichever tab is currently active. */}
      <AddRaceSheet visible={isAddSheetVisible} onClose={() => setAddSheetVisible(false)} onSelect={handleAddRaceSelect} />
    </>
  );
}
