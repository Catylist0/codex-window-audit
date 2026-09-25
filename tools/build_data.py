"""Build an aggregate-only static dataset from local native Codex session logs."""

import collections, datetime as dt, json, pathlib, re
from zoneinfo import ZoneInfo

HOME = pathlib.Path.home()
TZ = ZoneInfo('Europe/London')
ENTRIES = json.loads((HOME / '.local/state/omarchy/agents/pricing/ledger.json').read_text())['entries']
EVENTS = []
WINDOWS = collections.defaultdict(list)
for directory in ('sessions', 'archived_sessions'):
    for path in (HOME / '.codex' / directory).rglob('*.jsonl'):
        model = 'codex'
        for line in path.open(errors='replace'):
            try:
                record = json.loads(line)
            except ValueError:
                continue
            payload = record.get('payload') or {}
            if not isinstance(payload, dict):
                continue
            if record.get('type') == 'turn_context':
                model = payload.get('model') or payload.get('model_slug') or model
            if payload.get('type') != 'token_count':
                continue
            try:
                timestamp = dt.datetime.fromisoformat(record['timestamp'].replace('Z', '+00:00'))
            except (KeyError, ValueError):
                continue
            limits = payload.get('rate_limits') or {}
            window = limits.get('primary') or {}
            if window.get('window_minutes') == 300 and window.get('resets_at') is not None and window.get('used_percent') is not None:
                WINDOWS[(limits.get('limit_id'), int(window['resets_at']))].append((timestamp, float(window['used_percent'])))
            usage = (payload.get('info') or {}).get('last_token_usage') or {}
            cached = int(usage.get('cached_input_tokens') or 0)
            write = int(usage.get('cache_write_input_tokens') or 0)
            fresh = max(0, int(usage.get('input_tokens') or 0) - cached - write)
            output = int(usage.get('output_tokens') or 0)
            if fresh or cached or write or output:
                EVENTS.append((timestamp, model, fresh, cached, write, output))

def price(event):
    timestamp, model, fresh, cached, write, output = event
    day = timestamp.astimezone(TZ).date().isoformat()
    base = re.sub(r'-(?:\d{8}|\d{4}-\d{2}-\d{2})$', '', model)
    candidates = [entry for entry in ENTRIES if entry['from'] <= day <= entry['through'] and entry['model'] in (model, base)]
    exact = [entry for entry in candidates if entry['model'] == model]
    rates = (exact or candidates)[-1]['rates'] if candidates else None
    assumption = False
    if rates is None and model == 'gpt-5.5' and '2026-04-24' <= day <= '2026-07-11':
        rates = {'input': 5, 'cacheRead': 0.5, 'cacheWrite': None, 'output': 30}
        assumption = True
    if rates is None and model == 'gpt-5.6-sol' and '2026-07-09' <= day <= '2026-08-20':
        rates = {'input': 5, 'cacheRead': 0.5, 'cacheWrite': 6.25, 'output': 30}
        assumption = True
    if rates is None or any(amount and rates.get(field) is None for amount, field in ((fresh, 'input'), (cached, 'cacheRead'), (write, 'cacheWrite'), (output, 'output'))):
        return None, assumption
    return (fresh * rates['input'] + cached * (rates.get('cacheRead') or 0) + write * (rates.get('cacheWrite') or 0) + output * rates['output']) / 1_000_000, assumption

GROUPS = []
for (limit_id, reset), samples in sorted(WINDOWS.items(), key=lambda pair: pair[0][1]):
    # The same server window can be stamped several seconds apart across clients.
    # July 2 has overlapping 5-hour readings with reset timestamps 3-4s apart.
    if GROUPS and GROUPS[-1]['limit_id'] == limit_id and reset - GROUPS[-1]['reset'] <= 120:
        GROUPS[-1]['samples'].extend(samples)
    else:
        GROUPS.append({'limit_id': limit_id, 'reset': reset, 'samples': samples[:]})

ROWS = []
for group in GROUPS:
    max_percent = max(percent for _, percent in group['samples'])
    if max_percent < 80:
        continue
    end = max(timestamp for timestamp, _ in group['samples'])
    start = dt.datetime.fromtimestamp(group['reset'] - 18000, dt.timezone.utc)
    events = [event for event in EVENTS if start <= event[0] <= end]
    tokens = collections.Counter()
    dollars = collections.Counter()
    unknown = collections.Counter()
    inferred = False
    for event in events:
        model = event[1]
        tokens[model] += sum(event[2:])
        cost, assumption = price(event)
        inferred |= assumption
        if cost is None:
            unknown[model] += 1
        else:
            dollars[model] += cost
    total_tokens = sum(tokens.values())
    rows = [(model, round(amount / total_tokens * 100)) for model, amount in tokens.most_common() if total_tokens]
    ROWS.append({'date': end.astimezone(TZ).date().isoformat(), 'end': end.astimezone(TZ).strftime('%H:%M'),
        'percent': max_percent, 'tokens': total_tokens, 'mix': rows, 'cost': sum(dollars.values()),
        'unknown': dict(unknown), 'inferred': inferred, 'dollars': dict(dollars),
        'modelTokens': dict(tokens), 'minPercent': min(percent for _, percent in group['samples']),
        'snapshotCount': len(group['samples']), 'firstReadingAt': min(timestamp for timestamp, _ in group['samples']).isoformat(),
        'lastReadingAt': end.isoformat(), 'resetAt': dt.datetime.fromtimestamp(group['reset'], dt.timezone.utc).isoformat()})

if __name__ == '__main__':
    output = pathlib.Path(__file__).resolve().parent.parent / 'data.js'
    records = []
    for row in ROWS:
        records.append({
            'date': row['date'], 'time': row['end'], 'firstReadingAt': row['firstReadingAt'],
            'lastReadingAt': row['lastReadingAt'], 'resetAt': row['resetAt'],
            'maxPercent': row['percent'], 'minPercent': row['minPercent'], 'snapshotCount': row['snapshotCount'],
            'recordedUsd': round(row['cost'], 6),
            'fullWindowUsd': round(row['cost'] / (row['percent'] / 100), 6),
            'observedFull': row['percent'] >= 100, 'priceQuality': 'partial' if row['unknown'] else ('historical-inferred' if row['inferred'] else 'dated-ledger'),
            'unpricedModels': list(row['unknown']), 'totalTokens': row['tokens'],
            'modelTokens': row['modelTokens'], 'modelUsd': {key: round(value, 6) for key, value in row['dollars'].items()},
        })
    report = {'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'timeZone': 'Europe/London',
              'definition': 'Native Codex primary 300-minute rate-limit readings; windows with maximum used_percent >= 80',
              'records': records}
    output.write_text('window.REPORT = ' + json.dumps(report, separators=(',', ':')) + ';\n')
    print(f'Wrote {len(records)} aggregate windows to {output}')
