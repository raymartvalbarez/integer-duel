import sys, re, json, random, asyncio
from playwright.async_api import async_playwright
BASE = sys.argv[1].rstrip('/'); NS = sys.argv[2]; MODE = sys.argv[3] if len(sys.argv) > 3 else 'full'
SHOTS = sys.argv[4] if len(sys.argv) > 4 else '/workspace/idfix_shots/lobby'
Q = '?ns=' + NS
MOBILE = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
WAIT_Q = "document.querySelector('#screen-result.active') || (document.querySelector('#screen-game.active') && document.querySelectorAll('#q-choices .chip:not([disabled])').length==4 && __IDU.state() && __IDU.state().phase=='q')"
async def fill(p, name, grade, sec):
    await p.fill('#inp-name', name); await p.select_option('#inp-grade', grade); await p.fill('#inp-section', sec)
async def play(p, prob, delay):
    last = 0
    while True:
        await p.wait_for_function(WAIT_Q, timeout=120000)
        if await p.query_selector('#screen-result.active'): return
        st = await p.evaluate("(()=>{const g=__IDU.state();return {r:g.r,k:g.qs[g.r-1].k}})()")
        if st['r'] == last: await p.wait_for_timeout(300); continue
        last = st['r']; await p.wait_for_timeout(int(delay * 1000))
        k = st['k'] if random.random() < prob else (st['k'] + 1 + random.randint(0, 2)) % 4
        await p.click(f'#q-choices .chip:nth-child({k+1})')
async def online_has(p, name, timeout=40000):
    await p.wait_for_function("n=>[...document.querySelectorAll('#online-list .orow b')].some(b=>b.textContent===n)", arg=name, timeout=timeout)
async def invite(p, name):
    await p.evaluate("n=>{const r=[...document.querySelectorAll('#online-list .orow')].find(r=>r.querySelector('b').textContent===n);r.querySelector('button').click()}", name)
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--no-sandbox'])
        errs = []
        ca = await b.new_context(**MOBILE); cb = await b.new_context(**MOBILE)
        A = await ca.new_page(); B = await cb.new_page()
        for pg in (A, B): pg.on('pageerror', lambda e: errs.append(str(e)))
        await A.goto(f'{BASE}/{Q}'); await B.goto(f'{BASE}/{Q}')
        await A.wait_for_timeout(1500)
        await fill(A, 'TEST Bot A', '11', 'TEST-A')
        await A.wait_for_timeout(1500)
        print('A alone online text:', (await A.inner_text('#online')).replace('\n', ' | '))
        await A.screenshot(path=f'{SHOTS}/online_empty.png')
        await fill(B, 'TEST Bot B', '12', 'TEST-B')
        await online_has(A, 'TEST Bot B'); await online_has(B, 'TEST Bot A')
        print('both see each other OK')
        await A.screenshot(path=f'{SHOTS}/online_list_A.png'); await B.screenshot(path=f'{SHOTS}/online_list_B.png')
        # --- decline
        await invite(A, 'TEST Bot B')
        await A.wait_for_selector('#screen-lobby.active'); print('A lobby:', (await A.inner_text('#lobby-invite')).replace('\n', ' '), '| cancel btn:', await A.inner_text('#btn-cancel'))
        await B.wait_for_selector('#invite-pop:not([hidden])', timeout=20000)
        print('B popup:', (await B.inner_text('#invite-pop')).replace('\n', ' | '))
        await B.screenshot(path=f'{SHOTS}/invite_popup_B.png'); await A.screenshot(path=f'{SHOTS}/inviter_waiting_A.png')
        await B.click('#inv-decline')
        await A.wait_for_selector('#screen-home.active', timeout=15000)
        print('A after decline:', await A.inner_text('#home-info'))
        # --- cancel
        await online_has(A, 'TEST Bot B')
        await invite(A, 'TEST Bot B'); await A.wait_for_selector('#screen-lobby.active')
        await B.wait_for_selector('#invite-pop:not([hidden])', timeout=20000)
        await A.click('#btn-cancel'); await A.wait_for_selector('#screen-home.active')
        await B.wait_for_selector('#invite-pop', state='hidden', timeout=15000)
        print('B after A cancel:', await B.inner_text('#home-info'))
        # --- timeout (no response)
        await online_has(A, 'TEST Bot B')
        await invite(A, 'TEST Bot B'); await A.wait_for_selector('#screen-lobby.active')
        await B.wait_for_selector('#invite-pop:not([hidden])', timeout=20000)
        await A.wait_for_selector('#screen-home.active', timeout=45000)
        print('A after timeout:', await A.inner_text('#home-info'))
        await B.wait_for_selector('#invite-pop', state='hidden', timeout=15000)
        print('B popup closed after timeout; B info:', await B.inner_text('#home-info') if await B.is_visible('#home-info') else '(none)')
        if MODE == 'full':
            await online_has(A, 'TEST Bot B')
            await invite(A, 'TEST Bot B'); await A.wait_for_selector('#screen-lobby.active')
            await B.wait_for_selector('#invite-pop:not([hidden])', timeout=20000)
            await B.click('#inv-accept')
            cc = await b.new_context(**MOBILE); C = await cc.new_page(); await C.goto(f'{BASE}/{Q}'); await fill(C, 'TEST Bot C', '10', 'TEST-C')
            await C.wait_for_function("()=>[...document.querySelectorAll('#online-list .orow button')].filter(b=>b.disabled&&b.textContent==='In a duel').length>=2", timeout=40000)
            print('C sees A and B as In a duel:', (await C.inner_text('#online-list')).replace('\n', ' | '))
            await C.screenshot(path=f'{SHOTS}/in_a_duel_C.png')
            await asyncio.gather(play(A, 0.9, 1.0), play(B, 0.5, 2.0))
            for nm, pg in (('A', A), ('B', B)):
                t = await pg.inner_text('#screen-result'); print(nm, 'RESULT:', t.replace('\n', ' | ')[:160])
            await A.wait_for_timeout(8000)
            print('A save:', await A.inner_text('#res-save'), '| B save:', await B.inner_text('#res-save'))
            await A.screenshot(path=f'{SHOTS}/result_A.png')
            L = await ca.new_page(); await L.goto(f'{BASE}/leaderboard.html{Q}'); await L.wait_for_timeout(3500)
            print('LB:', (await L.inner_text('#rank-body'))[:300].replace('\n', ' | '))
            # in-duel status check: both back to home then 'again'
        else:
            # real-namespace mode: just confirm list works then close
            pass
        print('PAGE ERRORS:', errs)
        await b.close()
asyncio.run(main())
