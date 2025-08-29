```python
import pandas as pd

# FantasyFootballCalculator 2QB ADP (10-team, all scoring)
ffc_url = "https://fantasyfootballcalculator.com/adp/2qb/10-team/all"
ffc_tables = pd.read_html(ffc_url)
ffc_df = ffc_tables[0]   # usually first table on page

# FantasyPros DraftWizard ADP (2QB standard 10-team)
fp_url = "https://draftwizard.fantasypros.com/football/adp/mock-drafts/overall/2qb-std-10-teams"
fp_tables = pd.read_html(fp_url)
fp_df = fp_tables[0]

# Clean up headers, standardize player names
ffc_df.columns = [c.strip().upper() for c in ffc_df.columns]
fp_df.columns = [c.strip().upper() for c in fp_df.columns]

```


```python
players_left = ffc_df['NAME']
players_right = fp_df['PLAYER']
left_orphans = set(players_left) - set(players_right)
right_orphans = set(players_right) - set(players_left)
print(left_orphans)
print(right_orphans)
```

    {'Tampa Bay Defense', 'Denver Defense', 'Chicago Defense', 'Cleveland Defense', 'NY Giants Defense', 'Minnesota Defense', 'Houston Defense', 'Washington Defense', 'Will Reichard', 'Kansas City Defense', 'Seattle Defense', 'Jake Moody', 'LA Rams Defense', 'Buffalo Defense', 'Green Bay Defense', 'Arizona Defense', 'Brandon McManus', 'Baltimore Defense', 'Dallas Defense', 'Philadelphia Defense', 'Shedeur Sanders', 'Brenton Strange', 'Cameron Ward', 'Patrick Mahomes', 'San Francisco Defense', 'Detroit Defense', 'Pittsburgh Defense', 'Jake Elliott', 'Chris Godwin'}
    {'San Francisco 49ers', 'Devin Neal', 'Elijah Mitchell', 'Jack Bech', 'Denver Broncos', 'Jordan James', 'Justice Hill', 'Emanuel Wilson', 'Philadelphia Eagles', 'Jarquez Hunter', 'Baltimore Ravens', 'New York Jets', 'Kendre Miller', 'Cam Ward', 'Miles Sanders', 'Pittsburgh Steelers', 'Seattle Seahawks', 'Alec Pierce', 'Detroit Lions', 'Patrick Mahomes II', "Dont'e Thornton Jr.", 'Buffalo Bills', 'Raheem Mostert', 'Los Angeles Chargers', 'Isaiah Likely', 'Houston Texans', 'Chicago Bears', 'Jonnu Smith', 'Rico Dowdle', 'New York Giants', 'New England Patriots', 'Woody Marks', 'Blake Corum', 'Dameon Pierce', 'Brashard Smith', 'Quentin Johnston', 'Keaton Mitchell', 'Tahj Brooks', 'Chris Godwin Jr.', 'Sean Tucker', 'Jalen Coker', 'Jason Myers', 'Dallas Cowboys', 'Kareem Hunt', 'Kyle Monangai', 'Jalen McMillan', 'Christian Watson', 'Matt Prater', 'Los Angeles Rams', 'Justin Tucker', 'Antonio Gibson', 'Kansas City Chiefs', 'Cleveland Browns', 'Daniel Carlson', 'Tampa Bay Buccaneers', 'Hunter Henry', 'Isaiah Davis', 'DJ Giddens', 'Green Bay Packers', 'MarShawn Lloyd', 'Washington Commanders', 'Will Shipley', 'Arizona Cardinals', 'Minnesota Vikings', 'Roschon Johnson', 'Trevor Etienne'}
    


```python
import pandas as pd
import numpy as np
import re
from unidecode import unidecode
from rapidfuzz import process, fuzz

# === 1) Utilities ===

ROMAN_SUFFIXES = {"ii", "iii", "iv", "jr", "sr"}
NICKNAME_MAP = {
    # common short→full (add as needed)
    "cam": "cameron",
    "dj": "dj",  # leave as-is unless you want "deejay"
    "aj": "aj",
    "bj": "bj",
    # fix common apostrophe variants
    "dont'e": "donte",
}
# Normalize team / city aliases for DSTs
DST_CANON = {
    "arizona": "arizona cardinals",
    "atlanta": "atlanta falcons",
    "baltimore": "baltimore ravens",
    "buffalo": "buffalo bills",
    "carolina": "carolina panthers",
    "chicago": "chicago bears",
    "cincinnati": "cincinnati bengals",
    "cleveland": "cleveland browns",
    "dallas": "dallas cowboys",
    "denver": "denver broncos",
    "detroit": "detroit lions",
    "green bay": "green bay packers",
    "houston": "houston texans",
    "indianapolis": "indianapolis colts",
    "jacksonville": "jacksonville jaguars",
    "kansas city": "kansas city chiefs",
    "las vegas": "las vegas raiders",
    "chargers": "los angeles chargers",
    "rams": "los angeles rams",
    "la chargers": "los angeles chargers",
    "la rams": "los angeles rams",
    "los angeles chargers": "los angeles chargers",
    "los angeles rams": "los angeles rams",
    "miami": "miami dolphins",
    "minnesota": "minnesota vikings",
    "new england": "new england patriots",
    "new orleans": "new orleans saints",
    "ny giants": "new york giants",
    "new york giants": "new york giants",
    "ny jets": "new york jets",
    "new york jets": "new york jets",
    "philadelphia": "philadelphia eagles",
    "pittsburgh": "pittsburgh steelers",
    "san francisco": "san francisco 49ers",
    "seattle": "seattle seahawks",
    "tampa bay": "tampa bay buccaneers",
    "tennessee": "tennessee titans",
    "washington": "washington commanders",
}
SUFFIX_RX = re.compile(r"\b(jr|sr|ii|iii|iv)\b", flags=re.I)
```


```python
def normalize_columns(left, right):
    left = left.copy()
    right = right.copy()
    
    left.drop(columns=['GRAPH','TIMES DRAFTED'], inplace=True)

    left.columns = [
        'RANK',
        'PICK',
        'PLAYER',
        'POS',
        'TEAM',
        'BYE',
        'OVERALL',
        'STD',
        'HIGH',
        'LOW'
    ]
    def splitTB(val):
        if val is np.nan:
            return pd.Series([None, None])
        team, bye = val.split('(')
        bye = bye.replace('(','')
        bye = bye.replace(')','')
        return pd.Series([team, bye])
        
    
    right.columns = [
        'POS',
        'RANK',
        'PLAYER',
        'TEAM (BYE)',
        'PICK',
        'HIGH',
        'LOW',
        'STD',
        'PCT'        
    ]
    right[['TEAM', 'BYE']] = right['TEAM (BYE)'].apply(splitTB)
    right['POS'] = right['POS'].apply(lambda x: re.sub(r'\d*', '', x))
    right.drop(columns=['TEAM (BYE)'], inplace=True)
    return left, right

df_l, df_r = normalize_columns(ffc_df, fp_df)
```


```python
def diffrep(l, r, col='PLAYER'):
    pl = set(l[col])
    pr = set(r[col])
    lo = pl - pr
    ro = pr - pl
    print(lo, len(lo))
    print(ro, len(ro))
diffrep(df_l, df_r)
```

    {'Tampa Bay Defense', 'Denver Defense', 'Chicago Defense', 'Cleveland Defense', 'NY Giants Defense', 'Minnesota Defense', 'Houston Defense', 'Washington Defense', 'Will Reichard', 'Kansas City Defense', 'Seattle Defense', 'Jake Moody', 'LA Rams Defense', 'Buffalo Defense', 'Green Bay Defense', 'Arizona Defense', 'Brandon McManus', 'Baltimore Defense', 'Dallas Defense', 'Philadelphia Defense', 'Shedeur Sanders', 'Brenton Strange', 'Cameron Ward', 'Patrick Mahomes', 'San Francisco Defense', 'Detroit Defense', 'Pittsburgh Defense', 'Jake Elliott', 'Chris Godwin'} 29
    {'San Francisco 49ers', 'Devin Neal', 'Elijah Mitchell', 'Jack Bech', 'Denver Broncos', 'Jordan James', 'Justice Hill', 'Emanuel Wilson', 'Philadelphia Eagles', 'Jarquez Hunter', 'Baltimore Ravens', 'New York Jets', 'Kendre Miller', 'Cam Ward', 'Miles Sanders', 'Pittsburgh Steelers', 'Seattle Seahawks', 'Alec Pierce', 'Detroit Lions', 'Patrick Mahomes II', "Dont'e Thornton Jr.", 'Buffalo Bills', 'Raheem Mostert', 'Los Angeles Chargers', 'Isaiah Likely', 'Houston Texans', 'Chicago Bears', 'Jonnu Smith', 'Rico Dowdle', 'New York Giants', 'New England Patriots', 'Woody Marks', 'Blake Corum', 'Dameon Pierce', 'Brashard Smith', 'Quentin Johnston', 'Keaton Mitchell', 'Tahj Brooks', 'Chris Godwin Jr.', 'Sean Tucker', 'Jalen Coker', 'Jason Myers', 'Dallas Cowboys', 'Kareem Hunt', 'Kyle Monangai', 'Jalen McMillan', 'Christian Watson', 'Matt Prater', 'Los Angeles Rams', 'Justin Tucker', 'Antonio Gibson', 'Kansas City Chiefs', 'Cleveland Browns', 'Daniel Carlson', 'Tampa Bay Buccaneers', 'Hunter Henry', 'Isaiah Davis', 'DJ Giddens', 'Green Bay Packers', 'MarShawn Lloyd', 'Washington Commanders', 'Will Shipley', 'Arizona Cardinals', 'Minnesota Vikings', 'Roschon Johnson', 'Trevor Etienne'} 66
    


```python
df_l['is_dst'] = df_l['POS'] == 'DEF'
df_r['is_dst'] = df_r['POS'] == 'DST'
df_l['is_dst'].sum(), df_r['is_dst'].sum()
```




    (np.int64(20), np.int64(23))




```python
def _clean_tokens(name: str) -> list[str]:
    name = unidecode(name).lower()
    name = name.replace("&", " and ")
    name = re.sub(r"[^a-z0-9\s']", " ", name)  # keep simple apostrophes
    name = re.sub(r"\s+", " ", name).strip()

    # nickname normalization (token-wise)
    toks = name.split()
    toks = [NICKNAME_MAP.get(t, t) for t in toks]
    # drop roman suffixes / jr/sr
    toks = [t for t in toks if t not in ROMAN_SUFFIXES]
    return toks

def clean_name(name: str) -> str:
    toks = _clean_tokens(name)
    # collapse repeated tokens
    out = " ".join(dict.fromkeys(toks))
    out = SUFFIX_RX.sub("", out).strip()
    out = re.sub(r"\s+", " ", out)
    return out
df_l['PLAYER_CLEAN'] = df_l['PLAYER'].apply(clean_name)
df_r['PLAYER_CLEAN'] = df_r['PLAYER'].apply(clean_name)
```


```python

diffrep(df_l, df_r, col="PLAYER_CLEAN")
```

    {'arizona defense', 'brandon mcmanus', 'brenton strange', 'shedeur sanders', 'tampa bay defense', 'dallas defense', 'denver defense', 'jake moody', 'seattle defense', 'washington defense', 'chicago defense', 'detroit defense', 'cleveland defense', 'kansas city defense', 'green bay defense', 'ny giants defense', 'la rams defense', 'buffalo defense', 'san francisco defense', 'baltimore defense', 'minnesota defense', 'jake elliott', 'philadelphia defense', 'pittsburgh defense', 'houston defense', 'will reichard'} 26
    {'isaiah likely', 'isaiah davis', 'minnesota vikings', 'woody marks', 'dallas cowboys', 'tahj brooks', 'justin tucker', 'kareem hunt', 'emanuel wilson', 'houston texans', 'seattle seahawks', 'jonnu smith', 'arizona cardinals', 'san francisco 49ers', 'antonio gibson', 'jarquez hunter', 'cleveland browns', 'new england patriots', 'kendre miller', 'marshawn lloyd', 'keaton mitchell', 'will shipley', 'raheem mostert', 'chicago bears', 'hunter henry', 'jalen mcmillan', 'dj giddens', 'elijah mitchell', 'donte thornton', 'los angeles chargers', 'roschon johnson', 'trevor etienne', 'blake corum', 'christian watson', 'justice hill', 'new york jets', 'jordan james', 'philadelphia eagles', 'quentin johnston', 'pittsburgh steelers', 'rico dowdle', 'dameon pierce', 'sean tucker', 'new york giants', 'los angeles rams', 'daniel carlson', 'tampa bay buccaneers', 'brashard smith', 'matt prater', 'kansas city chiefs', 'denver broncos', 'washington commanders', 'jason myers', 'green bay packers', 'detroit lions', 'buffalo bills', 'alec pierce', 'miles sanders', 'jalen coker', 'jack bech', 'kyle monangai', 'baltimore ravens', 'devin neal'} 63
    


```python
df_r['is_dst']
```




    0      False
    1      False
    2      False
    3      False
    4      False
           ...  
    252    False
    253     True
    254     True
    255     True
    256    False
    Name: is_dst, Length: 257, dtype: bool




```python
def canonical_dst(player: str) -> str:
    """
    Map variants like 'NY Giants Defense', 'San Francisco Defense'
    to 'new york giants', 'san francisco 49ers'
    """
    #p = clean_player(player)
    p = player
    # remove trailing defense/def/dst
    p = re.sub(r"\b(defense|def|dst)\b", "", p).strip()
    # handle obvious city-only names
    # try longest matching key
    keys = sorted(DST_CANON.keys(), key=len, reverse=True)
    for k in keys:
        if p.startswith(k):
            return DST_CANON[k]
    # last resort: if it already contains '49ers', 'bills', etc., keep it
    return p

    return out
df_l['PLAYER_CLEAN'] = df_l['PLAYER_CLEAN'].apply(canonical_dst)#df_l.apply(lambda r: r['PLAYER_CLEAN'] if not r['is_dst'] else canonical_dst(r['PLAYER_CLEAN']))
df_r['PLAYER_CLEAN'] = df_r['PLAYER_CLEAN'].apply(canonical_dst)#df_r.apply(lambda r: r['PLAYER_CLEAN'] if not r['is_dst'] else canonical_dst(r['PLAYER_CLEAN']))
```


```python
df_merged = df_l.merge(df_r.drop(columns=['PLAYER', 'TEAM', 'is_dst','BYE', 'POS']), on='PLAYER_CLEAN', suffixes=('_ffc','_fp'))
df_merged.head()
```




<div>
<style scoped>
    .dataframe tbody tr th:only-of-type {
        vertical-align: middle;
    }

    .dataframe tbody tr th {
        vertical-align: top;
    }

    .dataframe thead th {
        text-align: right;
    }
</style>
<table border="1" class="dataframe">
  <thead>
    <tr style="text-align: right;">
      <th></th>
      <th>RANK_ffc</th>
      <th>PICK_ffc</th>
      <th>PLAYER</th>
      <th>POS</th>
      <th>TEAM</th>
      <th>BYE</th>
      <th>OVERALL</th>
      <th>STD_ffc</th>
      <th>HIGH_ffc</th>
      <th>LOW_ffc</th>
      <th>is_dst</th>
      <th>PLAYER_CLEAN</th>
      <th>RANK_fp</th>
      <th>PICK_fp</th>
      <th>HIGH_fp</th>
      <th>LOW_fp</th>
      <th>STD_fp</th>
      <th>PCT</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th>0</th>
      <td>1</td>
      <td>1.02</td>
      <td>Josh Allen</td>
      <td>QB</td>
      <td>BUF</td>
      <td>7</td>
      <td>1.7</td>
      <td>0.8</td>
      <td>1.01</td>
      <td>1.05</td>
      <td>False</td>
      <td>josh allen</td>
      <td>1</td>
      <td>1.01</td>
      <td>1.01</td>
      <td>1.04</td>
      <td>0.57</td>
      <td>100%</td>
    </tr>
    <tr>
      <th>1</th>
      <td>2</td>
      <td>1.02</td>
      <td>Lamar Jackson</td>
      <td>QB</td>
      <td>BAL</td>
      <td>7</td>
      <td>1.8</td>
      <td>0.9</td>
      <td>1.01</td>
      <td>1.07</td>
      <td>False</td>
      <td>lamar jackson</td>
      <td>2</td>
      <td>1.02</td>
      <td>1.01</td>
      <td>1.03</td>
      <td>0.58</td>
      <td>100%</td>
    </tr>
    <tr>
      <th>2</th>
      <td>3</td>
      <td>1.03</td>
      <td>Joe Burrow</td>
      <td>QB</td>
      <td>CIN</td>
      <td>10</td>
      <td>2.8</td>
      <td>1.0</td>
      <td>1.01</td>
      <td>1.07</td>
      <td>False</td>
      <td>joe burrow</td>
      <td>5</td>
      <td>1.05</td>
      <td>1.03</td>
      <td>1.09</td>
      <td>1.32</td>
      <td>100%</td>
    </tr>
    <tr>
      <th>3</th>
      <td>4</td>
      <td>1.04</td>
      <td>Jayden Daniels</td>
      <td>QB</td>
      <td>WAS</td>
      <td>12</td>
      <td>4.2</td>
      <td>1.2</td>
      <td>1.01</td>
      <td>1.09</td>
      <td>False</td>
      <td>jayden daniels</td>
      <td>3</td>
      <td>1.04</td>
      <td>1.03</td>
      <td>1.07</td>
      <td>1.11</td>
      <td>100%</td>
    </tr>
    <tr>
      <th>4</th>
      <td>5</td>
      <td>1.05</td>
      <td>Saquon Barkley</td>
      <td>RB</td>
      <td>PHI</td>
      <td>9</td>
      <td>4.9</td>
      <td>1.8</td>
      <td>1.01</td>
      <td>1.11</td>
      <td>False</td>
      <td>saquon barkley</td>
      <td>8</td>
      <td>1.08</td>
      <td>1.03</td>
      <td>3.01</td>
      <td>2.90</td>
      <td>100%</td>
    </tr>
  </tbody>
</table>
</div>




```python
for c in [
    'RANK',
    'PICK',
]:
    a = f'{c}_ffc'
    b = f'{c}_fp'
    
    df_merged[c] = df_merged[a] + df_merged[b] / 2
    df_merged.drop(columns=[a,b], inplace=True)
df_merged.sort_values('RANK')
```




<div>
<style scoped>
    .dataframe tbody tr th:only-of-type {
        vertical-align: middle;
    }

    .dataframe tbody tr th {
        vertical-align: top;
    }

    .dataframe thead th {
        text-align: right;
    }
</style>
<table border="1" class="dataframe">
  <thead>
    <tr style="text-align: right;">
      <th></th>
      <th>PLAYER</th>
      <th>POS</th>
      <th>TEAM</th>
      <th>BYE</th>
      <th>OVERALL</th>
      <th>STD_ffc</th>
      <th>HIGH_ffc</th>
      <th>LOW_ffc</th>
      <th>is_dst</th>
      <th>PLAYER_CLEAN</th>
      <th>HIGH_fp</th>
      <th>LOW_fp</th>
      <th>STD_fp</th>
      <th>PCT</th>
      <th>RANK</th>
      <th>PICK</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th>0</th>
      <td>Josh Allen</td>
      <td>QB</td>
      <td>BUF</td>
      <td>7</td>
      <td>1.7</td>
      <td>0.8</td>
      <td>1.01</td>
      <td>1.05</td>
      <td>False</td>
      <td>josh allen</td>
      <td>1.01</td>
      <td>1.04</td>
      <td>0.57</td>
      <td>100%</td>
      <td>1.5</td>
      <td>1.525</td>
    </tr>
    <tr>
      <th>1</th>
      <td>Lamar Jackson</td>
      <td>QB</td>
      <td>BAL</td>
      <td>7</td>
      <td>1.8</td>
      <td>0.9</td>
      <td>1.01</td>
      <td>1.07</td>
      <td>False</td>
      <td>lamar jackson</td>
      <td>1.01</td>
      <td>1.03</td>
      <td>0.58</td>
      <td>100%</td>
      <td>3.0</td>
      <td>1.530</td>
    </tr>
    <tr>
      <th>2</th>
      <td>Joe Burrow</td>
      <td>QB</td>
      <td>CIN</td>
      <td>10</td>
      <td>2.8</td>
      <td>1.0</td>
      <td>1.01</td>
      <td>1.07</td>
      <td>False</td>
      <td>joe burrow</td>
      <td>1.03</td>
      <td>1.09</td>
      <td>1.32</td>
      <td>100%</td>
      <td>5.5</td>
      <td>1.555</td>
    </tr>
    <tr>
      <th>3</th>
      <td>Jayden Daniels</td>
      <td>QB</td>
      <td>WAS</td>
      <td>12</td>
      <td>4.2</td>
      <td>1.2</td>
      <td>1.01</td>
      <td>1.09</td>
      <td>False</td>
      <td>jayden daniels</td>
      <td>1.03</td>
      <td>1.07</td>
      <td>1.11</td>
      <td>100%</td>
      <td>5.5</td>
      <td>1.560</td>
    </tr>
    <tr>
      <th>5</th>
      <td>Jalen Hurts</td>
      <td>QB</td>
      <td>PHI</td>
      <td>9</td>
      <td>5.8</td>
      <td>1.5</td>
      <td>1.01</td>
      <td>1.11</td>
      <td>False</td>
      <td>jalen hurts</td>
      <td>1.02</td>
      <td>1.09</td>
      <td>1.59</td>
      <td>100%</td>
      <td>8.0</td>
      <td>1.585</td>
    </tr>
    <tr>
      <th>...</th>
      <td>...</td>
      <td>...</td>
      <td>...</td>
      <td>...</td>
      <td>...</td>
      <td>...</td>
      <td>...</td>
      <td>...</td>
      <td>...</td>
      <td>...</td>
      <td>...</td>
      <td>...</td>
      <td>...</td>
      <td>...</td>
      <td>...</td>
      <td>...</td>
    </tr>
    <tr>
      <th>210</th>
      <td>Tyler Loop</td>
      <td>PK</td>
      <td>BAL</td>
      <td>7</td>
      <td>162.1</td>
      <td>14.6</td>
      <td>11.11</td>
      <td>15.12</td>
      <td>False</td>
      <td>tyler loop</td>
      <td>16.09</td>
      <td>24.00</td>
      <td>13.19</td>
      <td>4%</td>
      <td>324.5</td>
      <td>28.555</td>
    </tr>
    <tr>
      <th>213</th>
      <td>Kyle Williams</td>
      <td>WR</td>
      <td>NE</td>
      <td>14</td>
      <td>166.1</td>
      <td>9.7</td>
      <td>13.01</td>
      <td>15.12</td>
      <td>False</td>
      <td>kyle williams</td>
      <td>18.02</td>
      <td>24.00</td>
      <td>10.72</td>
      <td>4%</td>
      <td>330.5</td>
      <td>28.600</td>
    </tr>
    <tr>
      <th>206</th>
      <td>Xavier Legette</td>
      <td>WR</td>
      <td>CAR</td>
      <td>14</td>
      <td>158.8</td>
      <td>11.7</td>
      <td>12.03</td>
      <td>15.08</td>
      <td>False</td>
      <td>xavier legette</td>
      <td>21.05</td>
      <td>24.00</td>
      <td>3.54</td>
      <td>2%</td>
      <td>332.0</td>
      <td>28.090</td>
    </tr>
    <tr>
      <th>211</th>
      <td>Younghoe Koo</td>
      <td>PK</td>
      <td>ATL</td>
      <td>5</td>
      <td>163.2</td>
      <td>11.5</td>
      <td>12.12</td>
      <td>15.12</td>
      <td>False</td>
      <td>younghoe koo</td>
      <td>18.00</td>
      <td>24.00</td>
      <td>8.49</td>
      <td>2%</td>
      <td>333.0</td>
      <td>28.575</td>
    </tr>
    <tr>
      <th>204</th>
      <td>Cleveland Defense</td>
      <td>DEF</td>
      <td>CLE</td>
      <td>9</td>
      <td>158.3</td>
      <td>16.1</td>
      <td>12.06</td>
      <td>15.11</td>
      <td>True</td>
      <td>cleveland browns</td>
      <td>23.05</td>
      <td>24.00</td>
      <td>0.72</td>
      <td>4%</td>
      <td>335.0</td>
      <td>28.080</td>
    </tr>
  </tbody>
</table>
<p>216 rows × 16 columns</p>
</div>




```python

```
