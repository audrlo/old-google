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

# CLDR gives every flag the single keyword "flag", so "us flag" would find
# nothing and "american flag" would find American Samoa. Each flag gets
# "<country> flag" as a keyword, and the ones people actually search get
# their everyday names too.
FLAG_ALIASES = {
    'United States': ['us', 'usa', 'america', 'american', 'united states'],
    'United Kingdom': ['uk', 'britain', 'british', 'great britain', 'england', 'english'],
    'South Korea': ['korea', 'korean'],
    'China': ['chinese'], 'Japan': ['japanese'], 'Germany': ['german'], 'France': ['french'],
    'Mexico': ['mexican'], 'Canada': ['canadian'], 'India': ['indian'], 'Brazil': ['brazilian'],
    'Australia': ['australian'], 'Italy': ['italian'], 'Spain': ['spanish'], 'Russia': ['russian'],
    'Ukraine': ['ukrainian'], 'Israel': ['israeli'], 'Ireland': ['irish'], 'Philippines': ['filipino', 'philippine'],
    'Netherlands': ['dutch', 'holland'], 'Sweden': ['swedish'], 'Nigeria': ['nigerian'], 'Vietnam': ['vietnamese'],
    'Taiwan': ['taiwanese'], 'Türkiye': ['turkey', 'turkish'], 'Poland': ['polish'], 'Greece': ['greek'],
    'Portugal': ['portuguese'], 'Argentina': ['argentine', 'argentinian'], 'Colombia': ['colombian'],
    'Pakistan': ['pakistani'], 'Egypt': ['egyptian'], 'Saudi Arabia': ['saudi'], 'Switzerland': ['swiss'],
    'Scotland': ['scottish'], 'Wales': ['welsh'], 'Puerto Rico': ['puerto rican'], 'Jamaica': ['jamaican'],
    'Cuba': ['cuban'], 'Dominican Republic': ['dominican'], 'Haiti': ['haitian'], 'Peru': ['peruvian'],
    'Chile': ['chilean'], 'Venezuela': ['venezuelan'], 'Iran': ['iranian', 'persian'], 'Iraq': ['iraqi'],
    'Indonesia': ['indonesian'], 'Thailand': ['thai'], 'Norway': ['norwegian'], 'Denmark': ['danish'],
    'Finland': ['finnish'], 'Belgium': ['belgian'], 'Austria': ['austrian'], 'New Zealand': ['kiwi', 'nz'],
    'South Africa': ['south african'], 'Kenya': ['kenyan'], 'Ghana': ['ghanaian'], 'Ethiopia': ['ethiopian'],
    'Morocco': ['moroccan'], 'Lebanon': ['lebanese'], 'Palestinian Territories': ['palestine', 'palestinian'],
    'Hong Kong SAR China': ['hong kong'], 'European Union': ['eu', 'europe', 'european'],
}
def flag_keywords(name):
    country = name.split(': ', 1)[1]
    words = [country.lower()] + FLAG_ALIASES.get(country, [])
    return words + [w + ' flag' for w in words]

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
    k = keywords.get(char) or keywords.get(key) or []
    if name.startswith('flag: '):
        k = k + flag_keywords(name)
    out.append({'c': char, 'n': name, 'k': k, 'g': group})

json.dump(out, open('data/emoji.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(out), 'emoji ->', 'data/emoji.json')
