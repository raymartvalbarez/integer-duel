import sys, re, json, random, asyncio
from playwright.async_api import async_playwright
BASE = sys.argv[1].rstrip('/')
NS = sys.argv[2] if len(sys.argv) > 2 else 'bnhs-integerduel-test1'
MODE = sys.argv[3] if len(sys.argv) > 3 else 'full'
SHOTS = '/workspace/integer-duel/shots'
Q = '?ns=' + NS
import os
B_UA = os.environ.get('B_UA'); B_INIT = os.environ.get('B_INIT')
MOBILE = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
WAIT_Q = "document.querySelector('#screen-result.active') || (document.querySelector('#screen-game.active') && document.querySelectorAll('#q-choices .chip:not([disabled])').length==4 && __IDU.state() && __IDU.state().phase=='q')"

async def fill(p, name, grade, sec):
    await p.fill('#inp-name', name); await p.select_option('#inp-grade', grade); await p.fill('#inp-section', sec)

async def play(p, who, prob, delay, log, stop_after=None, shot=None):
    last = 0
    while True:
        await p.wait_for_function(WAIT_Q, timeout=120000)
        if await p.query_selector('#screen-result.active'): return
        st = await p.evaluate("(()=>{const g=__IDU.state();return {r:g.r,k:g.qs[g.r-1].k}})()")
        if st['r'] == last: await p.wait_for_timeout(300); continue
        last = st['r']
        if stop_after and last > stop_after: return
        await p.wait_for_timeout(int(delay * 1000))
        if shot and last == shot[0]: await p.screenshot(path=shot[1])
        good = random.random() < prob
        k = st['k'] if good else (st['k'] + 1 + random.randint(0, 2)) % 4
        await p.click(f'#q-choices .chip:nth-child({k+1})')
        marked = await p.evaluate("document.querySelectorAll('#q-choices .chip.ok, #q-choices .chip.bad').length")
        assert marked == 1, 'only the tapped chip may be marked'
        log.append((who, last, good))

async def result_text(p):
    return await p.evaluate("({t:document.querySelector('#res-title').textContent,s:document.querySelector('#res-sub').textContent,me:document.querySelector('#res-me-p').textContent,opp:document.querySelector('#res-opp-p').textContent,mec:document.querySelector('#res-me-c').textContent,save:document.querySelector('#res-save').textContent,body:document.querySelector('#screen-result').innerText})")

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--no-sandbox'])
        errs = []
        if MODE in ('full', 'forfeit'):
            ca = await b.new_context(**MOBILE); cb = await b.new_context(**(dict(MOBILE, user_agent=B_UA) if B_UA else MOBILE))
            if B_INIT: await cb.add_init_script(B_INIT)
            A = await ca.new_page(); B = await cb.new_page()
            for pg in (A, B): pg.on('pageerror', lambda e: errs.append(str(e)))
            await A.goto(f'{BASE}/{Q}'); await B.goto(f'{BASE}/{Q}')
            await A.wait_for_timeout(2500)
            await A.screenshot(path=f'{SHOTS}/home.png')
            await fill(A, 'Ana Test', '11', 'HUMSS-T'); await A.click('#btn-create')
            await A.wait_for_selector('#screen-lobby.active')
            code = (await A.inner_text('#lobby-code')).strip(); print('CODE', code)
            assert re.fullmatch(r'[A-HJ-NP-Z2-9]{5}', code)
            await A.wait_for_timeout(500); await A.screenshot(path=f'{SHOTS}/lobby.png')
            await B.goto(f'{BASE}/?room={code}&ns={NS}')
            assert await B.input_value('#inp-code') == code
            await fill(B, 'Ben Test', '9', 'Newton'); await B.click('#btn-join')
            log = []
            async def runB():
                if MODE == 'forfeit':
                    await play(B, 'B', 0.5, 2.0, log, stop_after=3)
                    await B.wait_for_timeout(2600)
                    B.once('dialog', lambda d: asyncio.ensure_future(d.accept()))
                    await B.click('#btn-leave')
                else: await play(B, 'B', 0.5, 2.0, log)
            await asyncio.gather(play(A, 'A', 0.9, 1.0, log, shot=(4, f'{SHOTS}/midduel.png')), runB())
            ra = await result_text(A); print('LOG', ''.join('%s%d%s ' % (w, r, 'Y' if g else 'n') for w, r, g in sorted(log, key=lambda x: (x[1], x[0])))); print('A:', json.dumps({k: v for k, v in ra.items() if k != 'body'}, ensure_ascii=False))
            if MODE == 'full':
                rb = await result_text(B); print('B:', json.dumps({k: v for k, v in rb.items() if k != 'body'}, ensure_ascii=False))
                assert ra['me'] == rb['opp'] and ra['opp'] == rb['me'], 'scores disagree'
                assert ('win' in ra['t'].lower()) != ('win' in rb['t'].lower()) or 'draw' in ra['t'].lower()
            await A.wait_for_timeout(7000)
            print('A save:', (await result_text(A))['save'])
            if MODE == 'full': print('B save:', (await result_text(B))['save'])
            await A.screenshot(path=f'{SHOTS}/result_{MODE}.png')
            # leaderboard
            L = await ca.new_page(); await L.goto(f'{BASE}/leaderboard.html{Q}'); await L.wait_for_timeout(3500)
            print('LB:', (await L.inner_text('#rank-body'))[:400].replace('\n', ' | '))
            print('RECENT:', (await L.inner_text('#recent-body'))[:300].replace('\n', ' | '))
            await L.set_viewport_size({'width': 390, 'height': 844}); await L.screenshot(path=f'{SHOTS}/leaderboard_mobile.png', full_page=True)
            await L.click('button[data-g="9"]'); print('LB G9:', (await L.inner_text('#rank-body'))[:200].replace('\n', ' | '))
            await L.click('button[data-g="10"]'); print('LB G10:', (await L.inner_text('#rank-body'))[:120].replace('\n', ' | '))
            await ca.close(); await cb.close()
        if MODE == 'demo':
            c = await b.new_context(**MOBILE); P = await c.new_page(); P.on('pageerror', lambda e: errs.append(str(e)))
            await P.goto(f'{BASE}/?demo=1&ns={NS}'); await P.wait_for_timeout(1500)
            assert await P.is_visible('#demo-banner')
            await fill(P, 'Demo Kid', '8', 'Practice'); await P.click('#btn-demo')
            log = []; await play(P, 'D', 0.8, 0.5, log)
            r = await result_text(P); print('DEMO:', json.dumps({k: v for k, v in r.items() if k != 'body'}, ensure_ascii=False))
            assert 'not saved' in r['save'].lower()
            await P.screenshot(path=f'{SHOTS}/demo_result.png'); await c.close()
        print('PAGE ERRORS:', errs)
        await b.close()
asyncio.run(main())
