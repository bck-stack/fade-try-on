"""Turns the portrait screen recording (out/fade-try-on-demo.webm) into a 1920x1080
YouTube video: phone on the right, the current step and the YouCam API on the left,
and a text-to-speech voice-over timed to docs/VIDEO-SCRIPT.md.
Usage: python scripts/compose-video.py   (needs ffmpeg on PATH and `pip install edge-tts pillow`)
"""
import asyncio, os, subprocess, shutil
from PIL import Image, ImageDraw, ImageFont
import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "out")
WORK = os.path.join(OUT, "compose")
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"
VOICE = "en-GB-RyanNeural"
W, H = 1920, 1080
F = lambda s, b=True: ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf" if b else "C:/Windows/Fonts/segoeui.ttf", s)
S = lambda s: ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", s)

# (start, end, step, api, [(t, voice line)])
# Times are in the ORIGINAL recording. Waiting spinners are sped up (SPEED), and every
# time below is mapped through the same retiming, so the voice stays on its scene.
SPEED = [(54, 64, 4), (69, 75, 3), (81, 92, 4)]
SEG = [
    (0, 6.5, "Skin check before the cut", "A demo for the YouCam API hackathon", [(0.4, "Close cuts are hard on skin. This is Try-On: three YouCam APIs, for a fictional barbershop.")]),
    (6.5, 17, "1 · Consent first", "Photo goes to the YouCam API, deleted after each result", [(7.6, "Before any camera opens, the customer agrees: the photo goes to YouCam, and it's deleted after every result.")]),
    (17, 23, "2 · One selfie", "Resized on the phone. Serves every step", [(17.2, "One selfie, resized on the phone. The same photo does everything that follows.")]),
    (23, 47, "3 · Skin check", "YouCam AI Skin Analysis", [
        (23.6, "First, the skin check with YouCam AI Skin Analysis: redness, bumps, texture and oiliness."),
        (30.8, "Here it found noticeable redness. So instead of a foil or razor finish, it suggests a number one guard today, and a beard trim rather than a clean shave."),
        (40.6, "Then plain aftercare, no brands, and a clear line: not a medical assessment.")]),
    (47, 67.5, "4 · Try the cut", "AI Hairstyle Generator v2.1", [(47.5, "Now the cut. Tapered Fade is a real service on the price list. YouCam's Hairstyle Generator puts it on the customer's own face, and they can drag between before and after.")]),
    (67.5, 78.5, "5 · Try the beard", "AI Beard Style Generator", [(68, "Beards use YouCam's Beard Style Generator: here's the Anchor Beard, the shop's twenty-minute trim.")]),
    (78.5, 97.5, "6 · Cut + beard", "Hairstyle v2.1 → Beard Style, chained", [(79, "Cut plus Beard chains both: the hairstyle result goes straight into the beard task, so the picture matches the full service.")]),
    (97.5, 106.5, "7 · Compare", "Side by side, or everything tried", [(98, "Side by side, or every look tried so far. Going back to one costs nothing.")]),
    (106.5, 122, "8 · Book this look", "Live times from the shop's booking server (MCP)", [(107, "Booking uses the shop's diary through an MCP server, so these times are genuinely free. One consent box sends the look and a one-line skin note to the barber. Never the selfie, never the scores.")]),
    (122, 128, "9 · Booked", "The look and the suggested finish travel with it", [(122.5, "Booked. The confirmation shows the look and the suggested finish.")]),
    (128, 137, "10 · The barber's view", "Incoming looks, with the skin note", [(128.4, "And this is the barber's view. Before the customer sits down, he knows: noticeable redness, number one guard, no razor.")]),
    (137, 999, "Fade & Co. Try-On", "Skin Analysis · Hairstyle v2.1 · Beard Style", [(137.6, "Three YouCam APIs, one selfie, and nothing stored.")]),
]

def remap(t):
    out, prev = 0.0, 0.0
    for a, b, k in SPEED:
        if t <= a: break
        out += a - prev
        out += (min(t, b) - a) / k
        prev = b
        if t <= b: return out
    return out + max(0.0, t - prev)

def dur(p):
    return float(subprocess.check_output([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).decode())

def panel(step, api, idx):
    im = Image.new("RGB", (W, H), (20, 18, 16)); d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 12, H), fill=(178, 34, 34))
    d.text((110, 110), "FADE & CO. TRY-ON", font=S(30), fill=(201, 170, 110))
    d.text((110, 160), "Fictional demo barbershop · AI-generated face (FLUX)", font=F(26, False), fill=(150, 140, 125))
    y = 400
    words, line, lines = step.split(), "", []
    for w_ in words:
        t = (line + " " + w_).strip()
        if d.textlength(t, font=F(84)) > 1080: lines.append(line); line = w_
        else: line = t
    lines.append(line)
    for ln in lines: d.text((110, y), ln, font=F(84), fill=(245, 240, 230)); y += 104
    y += 30
    d.rounded_rectangle((110, y, 110 + d.textlength(api, font=S(38)) + 60, y + 76), 38, fill=(38, 72, 58))
    d.text((140, y + 38), api, font=S(38), fill=(220, 240, 228), anchor="lm")
    d.text((110, H - 110), "YouCam AI Skin Analysis · AI Hairstyle Generator v2.1 · AI Beard Style Generator", font=F(26, False), fill=(130, 122, 110))
    p = os.path.join(WORK, f"panel{idx:02d}.png"); im.save(p); return p

async def main():
    os.makedirs(WORK, exist_ok=True)
    raw = os.path.join(OUT, "fade-try-on-demo.webm")
    src = os.path.join(WORK, "retimed.mp4")
    parts, prev, fc0 = [], 0.0, ""
    for a, b, k in SPEED + [(dur(raw), dur(raw), 1)]:
        if a > prev: parts.append((prev, a, 1))
        if b > a: parts.append((a, b, k))
        prev = b
    for i, (a, b, k) in enumerate(parts):
        fc0 += f"[0:v]trim={a}:{b},setpts=(PTS-STARTPTS)/{k}[p{i}];"
    fc0 += "".join(f"[p{i}]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=1:a=0[v]"
    subprocess.run([FFMPEG, "-y", "-i", raw, "-filter_complex", fc0, "-map", "[v]", "-r", "30", "-c:v", "libx264", "-crf", "16", src], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    total = dur(src) + 6   # the last phone frame is held for the end card
    lst, audio = [], []
    for i, (a, b, step, api, lines) in enumerate(SEG):
        p = panel(step, api, i)
        lst.append(f"file '{p}'\nduration {min(remap(b), total) - remap(a):.3f}\n")
        for j, (t, text) in enumerate(lines):
            mp3 = os.path.join(WORK, f"v{i:02d}{j}.mp3")
            if not os.path.exists(mp3): await edge_tts.Communicate(text, VOICE, rate="+6%").save(mp3)
            audio.append((remap(t), mp3))
    lst.append(f"file '{p}'\n")
    listf = os.path.join(WORK, "panels.txt"); open(listf, "w").write("".join(lst).replace("\\", "/"))
    # warn if a line runs past the next line or the end of its segment
    for k, (t, mp3) in enumerate(audio):
        end = t + dur(mp3); nxt = audio[k + 1][0] if k + 1 < len(audio) else total
        if end > nxt: print(f"WARNING line at {t}s ends at {end:.1f}s, next starts {nxt}s")
    inputs = ["-f", "concat", "-safe", "0", "-i", listf, "-i", src]
    for t, mp3 in audio: inputs += ["-i", mp3]
    ph = 1000; pw = round(390 * ph / 844 / 2) * 2
    fc = f"[1:v]tpad=stop_mode=clone:stop_duration=6,scale={pw}:{ph},pad={pw+12}:{ph+12}:6:6:color=0x3a3530[ph];[0:v]fps=30[bg];[bg][ph]overlay=x={W-pw-230}:y=(H-{ph+12})/2,format=yuv420p[v];"
    for k, (t, _) in enumerate(audio): fc += f"[{k+2}:a]adelay={int(t*1000)}|{int(t*1000)}[a{k}];"
    fc += "".join(f"[a{k}]" for k in range(len(audio))) + f"amix=inputs={len(audio)}:normalize=0[a]"
    out = os.path.join(OUT, "fade-try-on-demo-youtube.mp4")
    subprocess.run([FFMPEG, "-y", *inputs, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-t", f"{total:.2f}",
                    "-r", "30", "-c:v", "libx264", "-crf", "19", "-c:a", "aac", "-b:a", "160k", out], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("wrote", out, round(dur(out), 1), "s")

asyncio.run(main())
