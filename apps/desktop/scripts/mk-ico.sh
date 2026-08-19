#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES_DIR="$SCRIPT_DIR/../resources"
INPUT="$RESOURCES_DIR/icon.png"
OUTPUT="$RESOURCES_DIR/icon.ico"

if [[ ! -f "$INPUT" ]]; then
  echo "错误: 未找到源图标: $INPUT"
  exit 1
fi

if ! command -v magick >/dev/null 2>&1; then
  echo "错误: 未找到 ImageMagick。macOS 可运行: brew install imagemagick"
  exit 1
fi

magick "$INPUT" \
  -define icon:auto-resize=256,128,64,48,32,16 \
  "$OUTPUT"

echo "已生成: $OUTPUT"
