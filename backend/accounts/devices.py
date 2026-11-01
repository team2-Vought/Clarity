"""Зрозуміла назва пристрою з User-Agent: «Chrome · Windows», «Safari · iPhone»."""

import re

# порядок важливий: Edge і Opera теж називають себе Chrome, Chrome — Safari
BROWSERS = [
    ('Edge', r'Edg(e|A|iOS)?/'),
    ('Opera', r'OPR/|Opera'),
    ('Samsung Internet', r'SamsungBrowser/'),
    ('Firefox', r'Firefox/|FxiOS/'),
    ('Chrome', r'Chrome/|CriOS/'),
    ('Safari', r'Safari/'),
]
SYSTEMS = [
    ('iPhone', r'iPhone'),
    ('iPad', r'iPad'),
    ('Android', r'Android'),
    ('Windows', r'Windows'),
    ('macOS', r'Mac OS X|Macintosh'),
    ('ChromeOS', r'CrOS'),
    ('Linux', r'Linux'),
]


def _first(table, agent):
    return next((name for name, pattern in table if re.search(pattern, agent)), '')


def describe_device(agent):
    agent = agent or ''
    parts = [part for part in (_first(BROWSERS, agent), _first(SYSTEMS, agent)) if part]
    return ' · '.join(parts) or (agent[:60] if agent else '')
