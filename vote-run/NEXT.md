# vote-run: handoff to the next session

## Where things stand
- The user rejected the hand-built Three.js character ("not Pixar at all"). Do not build on `src/` for the look.
- Chosen path: **Gemini**. Images with Gemini Image, then motion with Veo (paid, confirm cost before generating clips).
- The user asked for **one style frame first**; nothing else is generated until they approve it.
- Character reference (from the user): `assets/reference/hero_sheet.jpg`: young man, messy brown hair, beard,
  black t-shirt, beige cargo pants, dark sneakers.

## Ready to reuse
- Music: `assets/audio/music.wav` (original, 150 BPM, 30 s, made by `scripts/make_music.py`).
- Voiceover: `assets/audio/vo_take1.mp3` (ElevenLabs, voice "Nimrod", "כל קול חשוב! צאו להצביע!", 2.85 s; take2 is 2.27 s).
- End-card text design: `compositions/titles.html` (Rubik, flag blue #0038b8).
- Storyboard: front-door shock → street dodges → fruit-stand hurdle → rooftop leap + roll → awning bounce →
  traffic-jam weave → hood slide over a taxi → school polling station ("קלפי") → envelope into the ballot box → points at camera + end card.

## Step 1 in the new session (needs GEMINI_API_KEY)
```bash
cd vote-run
python3 scripts/gemini_image.py assets/style/style_frame.png "$(cat <<'EOF'
Create a single still frame in the style of a modern Pixar 3D animated feature film.
The hero is the man in the reference photos, reimagined as a Pixar character: keep his messy brown hair,
short beard, warm friendly face, black t-shirt, beige cargo pants and dark sneakers; stylized Pixar
proportions (slightly larger head and expressive eyes), soft subsurface-scattered skin, detailed hair strands.
Scene: election day in an Israeli city neighborhood street: white Jerusalem-stone apartment buildings with
balconies, solar water heaters on the roofs, ficus trees, red-and-white painted curbs, parked cars.
He is sprinting toward the camera mid-stride, determined and excited, dodging a surprised passer-by.
Cinematic low angle, warm golden morning light, shallow depth of field, rich color, Pixar render quality.
Vertical 9:16 composition. No text, no logos, no party symbols.
EOF
)" assets/reference/hero_sheet.jpg
```
Show the frame to the user and wait for approval before generating anything else.
