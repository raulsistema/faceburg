'use client';

import Image, { type ImageLoader, type ImageProps } from 'next/image';

const passthroughLoader: ImageLoader = ({ src }) => src;

type AppImageProps = Omit<ImageProps, 'loader'>;

export default function AppImage(props: AppImageProps) {
  return <Image {...props} loader={passthroughLoader} unoptimized />;
}
