export type NativeIOS = {
  bluetooth: () => void;
  disconnect: () => void;
  saveProgression: (name: string, text: string) => Promise<boolean>;
};
export function nativeIOS(): NativeIOS | undefined {
  return typeof window === 'undefined' ? undefined : (window as typeof window & { faithfulKeysIOS?: NativeIOS }).faithfulKeysIOS;
}
