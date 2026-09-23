import { useState } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, ScrollView, StyleSheet, View } from 'react-native';

import { RaceCountdownCard } from '@/components/race/RaceCountdownCard';
import type { Race } from '@/fixtures/races';
import { colors, spacing } from '@/lib/theme';

interface UpcomingCarouselProps {
  races: Race[];
  cardWidth: number;
  onOpenRace: (race: Race) => void;
}

/**
 * One RaceCountdownCard per upcoming race, soonest first, snap-scrolling horizontally — a single
 * race still renders as one full-width card with no indicator. The page dots below are the only
 * addition over a plain horizontal ScrollView: physical-device testing showed there was no visual
 * cue that more than one card existed to swipe to.
 */
export function UpcomingCarousel({ races, cardWidth, onOpenRace }: UpcomingCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const pageWidth = cardWidth + spacing.md;

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
    setActiveIndex(Math.max(0, Math.min(index, races.length - 1)));
  }

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={pageWidth}
        decelerationRate="fast"
        onScroll={handleScroll}
        scrollEventThrottle={32}
        contentContainerStyle={styles.carousel}>
        {races.map((race) => (
          <View key={race.id} style={{ width: cardWidth }}>
            <RaceCountdownCard race={race} onOpenRace={() => onOpenRace(race)} />
          </View>
        ))}
      </ScrollView>
      {races.length > 1 ? (
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {races.map((race, index) => (
            <View key={race.id} style={[styles.dot, index === activeIndex && styles.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  carousel: {
    gap: spacing.md,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.accent,
    width: 16,
  },
});
