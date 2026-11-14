# Held-out evaluation (threshold 0.7)

Voices never seen by the eval model: 14 (Sadachbia, Sadaltager, Shelley (English (UK)), Shelley (English (US)), Shelley (German (Germany)), Sulafat, Tara (English (India)), Tessa (English (South Africa)), Trinoids, Vindemiatrix, Whisper, Wobble, Zarvox, Zubenelgenubi).

| Set | Clips | Fired | Rate |
| --- | --- | --- | --- |
| Positives (“Hey Valo” / “Hey Daddy”) | 72 | 68 | 94.4% |
| Negatives: adversarial | 74 | 5 | 6.8% |
| Negatives: hard | 35 | 0 | 0.0% |
| Negatives: sentence | 79 | 0 | 0.0% |

Negatives that fired (text as synthesized):

- 1.00 · Sadaltager · “Say slowly and clearly: Hey Danny”
- 0.97 · Whisper · “Hey Daniel”
- 0.95 · Sulafat · “Say casually: Hey Paolo”
- 0.93 · Shelley (German (Germany)) · “Hey Daniel”
- 0.89 · Sadachbia · “Say slowly and clearly: Hey Daniel”

Positives that were missed:

- 0.00 · Shelley (English (US)) · “Hey Daddy!”
- 0.04 · Tara (English (India)) · “Hey Vahlo”
- 0.11 · Tessa (English (South Africa)) · “Hey Valo?”
- 0.46 · Tessa (English (South Africa)) · “Hey Vahlo”
