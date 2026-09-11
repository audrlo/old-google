#!/usr/bin/env python3
"""Builds data/emoji.json from Unicode's emoji-test.txt and CLDR's English
annotations: every fully-qualified emoji (skin-tone variants folded into
their base) with its CLDR name, keywords and group.

    python3 tools/build-emoji.py emoji-test.txt annotations/en.xml annotationsDerived/en.xml
"""
import json, re, sys, xml.etree.ElementTree as ET

test, annot, derived = sys.argv[1:4]
SKIN = {0x1F3FB, 0x1F3FC, 0x1F3FD, 0x1F3FE, 0x1F3FF}

names, keywords = {}, {}
for path in (annot, derived):
    for a in ET.parse(path).getroot().iter('annotation'):
        cp = a.get('cp')
        if a.get('type') == 'tts':
            names[cp] = a.text.strip()
        else:
            keywords[cp] = [k.strip() for k in a.text.split('|')]

out, seen, group = [], set(), ''
for line in open(test, encoding='utf-8'):
    if line.startswith('# group:'):
        group = line.split(':', 1)[1].strip()
        continue
    if '; fully-qualified' not in line:
        continue
    cps = [int(h, 16) for h in line.split(';')[0].split()]
    if any(c in SKIN for c in cps):
        continue  # the base emoji stands for its skin tones
    char = ''.join(chr(c) for c in cps)
    key = char.replace('️', '')
    name = names.get(char) or names.get(key)
    if not name or name in seen:
        continue
    seen.add(name)
    out.append({'c': char, 'n': name, 'k': keywords.get(char) or keywords.get(key) or [], 'g': group})

json.dump(out, open('data/emoji.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(out), 'emoji ->', 'data/emoji.json')
