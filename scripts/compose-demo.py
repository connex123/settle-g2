#!/usr/bin/env python3
"""Compose raw screen capture (1280x800: chat at 0,0 640x800; glasses at 660,0 576x288) into a 1920x1080 demo with captions."""
import json, subprocess, sys, os
raw, caps_file, out = sys.argv[1:4]
caps = json.load(open(caps_file))
chat_label = os.environ.get('CHAT_LABEL', 'Telegram group (local Bot API test chat)')
def ts(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"
ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "",
       "[V4+ Styles]",
       "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
       "Style: Cap,DejaVu Sans,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,7,880,60,0,1",
       "Style: Lbl,DejaVu Sans,28,&H0088AA99,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
       "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
end = max(c['start'] + c['dur'] for c in caps) + 2
ass.append(f"Dialogue: 0,{ts(0)},{ts(end)},Lbl,,0,0,0,,{{\\pos(40,30)}}{chat_label}")
ass.append(f"Dialogue: 0,{ts(0)},{ts(end)},Lbl,,0,0,0,,{{\\pos(880,70)}}Even G2 lens view (Even Hub simulator 0.9.5, live)")
for i, c in enumerate(caps):
    nxt = caps[i + 1]['start'] if i + 1 < len(caps) else c['start'] + c['dur'] + 2
    ass.append(f"Dialogue: 0,{ts(c['start'])},{ts(max(nxt, c['start'] + 1))},Cap,,0,0,0,,{{\\pos(880,700)\\q0}}{c['text']}")
open('/tmp/demo.ass', 'w').write("\n".join(ass) + "\n")
fc = ("color=c=0x0b0f0c:s=1920x1080:r=30[bg];"
      "[0:v]crop=640:800:0:0,scale=756:945[chat];"
      "[0:v]crop=576:288:660:0,scale=1008:504:flags=neighbor[g];"
      "[bg][chat]overlay=40:80:shortest=1[a];[a][g]overlay=880:120[b];"
      "[b]drawbox=x=876:y=116:w=1016:h=512:color=0x2f6f2f:t=3,ass=/tmp/demo.ass[v]")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-filter_complex", fc, "-map", "[v]",
                "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], check=True)
print(out)
