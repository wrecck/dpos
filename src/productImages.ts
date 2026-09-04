import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

export async function persistProductImage(
  sourceUri: string,
  originalFileName?: string | null,
) {
  if (Platform.OS === 'web') {
    return sourceUri;
  }

  const imageDirectory = new Directory(Paths.document, 'product-images');
  imageDirectory.create({ idempotent: true, intermediates: true });

  const source = new File(sourceUri);
  const extension = getExtension(originalFileName ?? sourceUri);
  const destination = new File(
    imageDirectory,
    `product-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`,
  );

  await source.copy(destination);
  return destination.uri;
}

function getExtension(value: string) {
  const withoutQuery = value.split('?')[0];
  const candidate = withoutQuery.split('.').pop()?.toLowerCase();
  return candidate && /^[a-z0-9]{2,5}$/.test(candidate) ? candidate : 'jpg';
}
