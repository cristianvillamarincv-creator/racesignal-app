import { Stack, useRouter } from 'expo-router';

import { FindMyRacesFlow } from '@/components/FindMyRacesFlow';

export default function FindRacesScreen() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: 'Find my races' }} />
      <FindMyRacesFlow onDone={() => router.back()} />
    </>
  );
}
