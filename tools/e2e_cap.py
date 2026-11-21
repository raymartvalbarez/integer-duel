"""Verify the 50-game cap on a test MantleDB namespace only."""
import sys, json, time, urllib.request, asyncio
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
NS = sys.argv[2] if len(sys.argv) > 2 else 'bnhs-integerduel-cap50-test'
assert NS.startswith('bnhs-integerduel-') and NS != 'bnhs-integerduel-nov2026'
Q = '?ns=' + NS
PLAYS_NS = NS + '-plays-1'
ROOT = 'https://mantledb.sh/v2/'
MOBILE = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
CAP_MSG = "You've finished your 50 Integer Duel games. Great job!"

def mantle(method, url, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json'} if body is not None else {'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return r.status, json.loads(raw.decode()) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: j = json.loads(raw.decode()) if raw else {}
        except Exception: j = {}
        return e.code, j

async def fill(p, name, grade, sec):
    await p.fill('#inp-name', name)
    await p.select_option('#inp-grade', grade)
    await p.fill('#inp-section', sec)
    await p.wait_for_timeout(800)

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--no-sandbox'])
        ca = await b.new_context(**MOBILE)
        A = await ca.new_page()
        errs = []
        A.on('pageerror', lambda e: errs.append(str(e)))
        await A.goto(f'{BASE}/{Q}')
        await A.wait_for_function('()=>window.IDBoard && window.__IDU', timeout=20000)
        await fill(A, 'Cap Kid', '11', 'ACADS')
        doc = await A.evaluate("()=>IDBoard.playDocId('Cap Kid','11','ACADS')")
        cap = await A.evaluate('()=>IDBoard.PLAY_CAP')
        assert cap == 50, cap
        ids = ['t-%s' % i for i in range(50)]
        status, resp = mantle('POST', ROOT + PLAYS_NS + '/' + doc, {'n': 'Cap Kid', 'g': '11', 's': 'ACADS', 'ids': ids, 't': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
        print('seed POST', status, doc, 'ns', PLAYS_NS)
        if status not in (200, 201):
            # already exists — overwrite with PATCH
            status, resp = mantle('PATCH', ROOT + PLAYS_NS + '/' + doc, {'n': 'Cap Kid', 'g': '11', 's': 'ACADS', 'ids': ids, 't': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
            print('seed PATCH', status)
        assert status in (200, 201), (status, resp)

        # reload so the page picks up the remote play log (and clear any local empty cache)
        await A.evaluate("()=>{try{localStorage.clear()}catch(e){}}")
        await A.goto(f'{BASE}/{Q}')
        await A.wait_for_function('()=>window.IDBoard && window.__IDU', timeout=20000)
        await fill(A, 'Cap Kid', '11', 'ACADS')
        await A.wait_for_function('()=>window.__IDU.plays() && window.__IDU.plays().ready && window.__IDU.plays().n>=50', timeout=25000)
        snap = await A.evaluate('()=>__IDU.plays()')
        print('CAP SNAP', json.dumps(snap))
        assert snap['n'] >= 50 and snap['atCap'] is True
        text = await A.inner_text('#plays-box')
        print('CAP UI', text.replace('\n', ' | '))
        assert '50 / 50' in text or '/ 50' in text
        assert 'finished your 50' in text
        assert await A.is_disabled('#btn-create')
        assert await A.is_disabled('#btn-join')
        assert await A.is_disabled('#btn-demo')

        # a second learner is under the cap and can still open a room; Cap Kid must not appear invitable
        cb = await b.new_context(**MOBILE)
        B = await cb.new_page()
        B.on('pageerror', lambda e: errs.append(str(e)))
        await B.goto(f'{BASE}/{Q}')
        await fill(B, 'Open Kid', '12', 'HUMSS')
        await B.wait_for_function('()=>window.__IDU.plays() && window.__IDU.plays().ready', timeout=25000)
        bsnap = await B.evaluate('()=>__IDU.plays()')
        print('OPEN SNAP', json.dumps(bsnap))
        assert bsnap['n'] == 0 and bsnap['atCap'] is False
        assert await B.is_enabled('#btn-create')
        await B.click('#btn-create')
        await B.wait_for_selector('#screen-lobby.active', timeout=20000)
        code = (await B.inner_text('#lobby-code')).strip()
        print('CODE', code)

        # Cap Kid should not show in Open Kid's online list as invitable
        await B.wait_for_timeout(8000)
        listed = await B.evaluate("""()=>[...document.querySelectorAll('#online-list .orow')].map(r=>({n:r.querySelector('b')&&r.querySelector('b').textContent, btn:r.querySelector('button')&&r.querySelector('button').textContent, dis:r.querySelector('button')&&r.querySelector('button').disabled}))""")
        print('ONLINE FROM B', listed)
        cap_rows = [r for r in listed if r.get('n') == 'Cap Kid']
        assert not cap_rows, 'capped learner must not appear as invitable/online-available'

        # Accepting via the app's ?accept=CODE path is also refused (input is disabled at the cap)
        await A.evaluate("""({n,g,s})=>{try{IDBoard.store.set('idu-profile', JSON.stringify({n,g,s}))}catch(e){}}""", {'n': 'Cap Kid', 'g': '11', 's': 'ACADS'})
        await A.goto(f'{BASE}/?accept={code}&ns={NS}')
        await A.wait_for_function('()=>window.__IDU && window.__IDU.plays', timeout=20000)
        await A.wait_for_timeout(4000)
        info = await A.inner_text('#plays-cap') if await A.is_visible('#plays-cap') else ''
        home = (await A.inner_text('#home-info')) if await A.is_visible('#home-info') else ''
        print('JOIN BLOCK', info, '|', home)
        assert CAP_MSG in (info + ' ' + home)
        assert await A.is_visible('#screen-home.active')
        # host should be told the invite/join was refused because of the cap
        await B.wait_for_timeout(2500)
        binfo = (await B.inner_text('#home-info')) if await B.is_visible('#home-info') else (await B.inner_text('#lobby-link') if await B.query_selector('#lobby-link') else '')
        print('HOST AFTER CAP JOIN', binfo.replace('\n',' | ')[:240])

        print('PAGE ERRORS:', errs)
        assert not errs
        await ca.close(); await cb.close()

asyncio.run(main())
