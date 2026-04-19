#!/bin/bash
# Quick Start — interactive command selector for mobile SSH
CONFIG="$HOME/projects/personal-biz/claude-hub/hub.config.json"

if ! command -v jq &>/dev/null; then
  echo "jq required: brew install jq"
  exit 1
fi

items=$(jq -r '.quickstart[] | if .section then "---\(.section)---" elif .cmd then "\(.label // .cmd)\t\(.cmd)" else empty end' "$CONFIG")

while true; do
  echo ""
  echo "=== Quick Start ==="
  echo ""
  i=0
  declare -a cmds=()
  while IFS= read -r line; do
    if [[ "$line" == ---*--- ]]; then
      section="${line#---}"
      section="${section%---}"
      echo ""
      echo "  [$section]"
    else
      i=$((i + 1))
      label="${line%%	*}"
      cmd="${line##*	}"
      cmds[$i]="$cmd"
      printf "  %2d) %s\n" "$i" "$label"
    fi
  done <<< "$items"

  echo ""
  echo "  0) Exit"
  echo ""
  read -p "番号を選択 > " choice

  [[ "$choice" == "0" || -z "$choice" ]] && break

  selected="${cmds[$choice]}"
  if [[ -n "$selected" ]]; then
    echo ""
    echo "📋 Copied to clipboard / コマンド:"
    echo ""
    echo "  $selected"
    echo ""
    # If running on macOS with pbcopy
    if command -v pbcopy &>/dev/null; then
      printf '%s' "$selected" | pbcopy
      echo "  (pbcopy済み — ペーストで実行)"
    else
      echo "  (上のコマンドをコピーして実行)"
    fi
    echo ""
    read -p "直接実行する? [y/N] > " run
    if [[ "$run" == "y" || "$run" == "Y" ]]; then
      eval "$selected"
    fi
  else
    echo "無効な番号です"
  fi
done
