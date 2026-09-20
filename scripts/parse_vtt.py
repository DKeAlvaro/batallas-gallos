#!/usr/bin/env python3
"""Parse YouTube auto-sub VTT (rolling captions) -> deduplicated timed lines."""
import json, re, sys, glob, os

TS = re.compile(r'(\d{2}):(\d{2}):(\d{2})\.(\d{3})')
TAG = re.compile(r'<[^>]+>')

def ts2s(t):
    m = TS.search(t)
    return int(m.group(1))*3600 + int(m.group(2))*60 + int(m.group(3)) + int(m.group(4))/1000

def parse(path):
    raw = open(path, encoding='utf-8').read()
    blocks = re.split(r'\n\s*\n', raw)[1:]
    lines = []
    for b in blocks:
        ls = b.strip().split('\n')
        idx = 0
        if '-->' not in ls[0]:
            idx = 1
        if idx >= len(ls) or '-->' not in ls[idx]:
            continue
        start = ts2s(ls[idx].split('-->')[0])
        text = ' '.join(TAG.sub('', l).strip() for l in ls[idx+1:]).strip()
        if text:
            lines.append((start, text))
    out = []
    prev_words = []
    for start, text in lines:
        words = text.split()
        k = 0
        maxk = min(len(words), len(prev_words))
        for k in range(maxk, 0, -1):
            if prev_words[-k:] == words[:k]:
                break
        else:
            k = 0
        new = words[k:]
        if new:
            out.append({'start': round(start, 2), 'text': ' '.join(new)})
            prev_words = words
    return out

def main():
    subs = os.path.expanduser('~/batallas/subs')
    ds = os.path.expanduser('~/batallas/dataset')
    for path in sorted(sys.argv[1:]):
        vid = os.path.basename(path).split('.')[0]
        lines = parse(path)
        json.dump({'video_id': vid, 'source': 'youtube-autosub', 'lines': lines},
                  open(os.path.join(ds, vid + '.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1)
        words = sum(len(l['text'].split()) for l in lines)
        print(f"{vid}: {len(lines)} lines, {words} words")

if __name__ == '__main__':
    main()
