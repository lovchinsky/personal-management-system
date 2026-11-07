#!/bin/sh
# Installs the installation's search dictionaries into Postgres and then runs the image's own entry
# point (ADR 0050). Compose starts the database container with it on every start.
#
# Postgres reads a dictionary only from its `tsearch_data` directory and only by a lowercase name,
# so the hunspell files of `infra/postgres/dictionaries/` are copied there under that name:
# `uk_UA.dic` becomes `uk_ua.dict`, `uk_UA.aff` becomes `uk_ua.affix` and an optional stop-word list
# `uk_UA.stop` becomes `uk_ua.stop`. Other files of the directory, such as a dictionary's license,
# stay where they are. The files are copied rather than linked: the server reads them as the
# `postgres` user, and the owner's files may be readable by their owner only.
set -eu

SOURCE=/etc/postgresql/dictionaries
TARGET="$(pg_config --sharedir)/tsearch_data"
# What this script installed on the previous start of the same container. Those files are removed
# first, so the installed set follows the directory, and the image's own files are never replaced.
MANIFEST="$TARGET/.installed-dictionaries"

if [ -f "$MANIFEST" ]; then
  while IFS= read -r installed_file; do
    rm -f "$TARGET/$installed_file"
  done < "$MANIFEST"
  rm -f "$MANIFEST"
fi

installed=''
for file in "$SOURCE"/*.dic "$SOURCE"/*.aff "$SOURCE"/*.stop; do
  [ -f "$file" ] || continue

  base="$(basename "$file")"
  name="$(printf '%s' "${base%.*}" | tr '[:upper:]' '[:lower:]')"
  case "$base" in
    *.dic) target="$name.dict" ;;
    *.aff) target="$name.affix" ;;
    *) target="$name.stop" ;;
  esac

  case "$name" in
    '' | [!a-z]* | *[!a-z0-9_]*)
      echo "install-dictionaries: $base: a dictionary name is Latin letters, digits and underscores, starting with a letter" >&2
      exit 1
      ;;
  esac

  case " $installed " in
    *" $target "*)
      echo "install-dictionaries: $base: another file of the directory is also installed as $target" >&2
      exit 1
      ;;
  esac
  if [ -e "$TARGET/$target" ]; then
    echo "install-dictionaries: $base: $target is a file of the Postgres image; give the dictionary another name" >&2
    exit 1
  fi

  install -m 0644 "$file" "$TARGET/$target"
  printf '%s\n' "$target" >> "$MANIFEST"
  installed="$installed $target"
done

if [ -n "$installed" ]; then
  echo "install-dictionaries: installed$installed"
fi

exec docker-entrypoint.sh "$@"
