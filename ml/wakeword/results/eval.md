# Held-out evaluation (threshold 0.7)

Voices never seen by the eval model: 14 (Sadachbia, Sadaltager, Shelley (English (UK)), Shelley (English (US)), Shelley (German (Germany)), Sulafat, Tara (English (India)), Tessa (English (South Africa)), Trinoids, Vindemiatrix, Whisper, Wobble, Zarvox, Zubenelgenubi).

| Set | Clips | Fired | Rate |
| --- | --- | --- | --- |
| Positives (“Hey Valo” / “Hey Daddy”) | 72 | 69 | 95.8% |
| Negatives: adversarial | 74 | 5 | 6.8% |
| Negatives: hard | 35 | 1 | 2.9% |
| Negatives: sentence | 79 | 0 | 0.0% |

Negatives that fired (text as synthesized):

- 1.00 · Sadaltager · “Say slowly and clearly: Hey Danny”
- 0.99 · Sulafat · “Who's your daddy?”
- 0.98 · Whisper · “Hey Daniel”
- 0.89 · Shelley (German (Germany)) · “Hey Daniel”
- 0.89 · Sadachbia · “Say quickly: Daddy”
- 0.82 · Zarvox · “Valo”

Positives that were missed:

- 0.00 · Shelley (English (US)) · “Hey Daddy!”
- 0.00 · Tara (English (India)) · “Hey Vahlo”
- 0.30 · Tessa (English (South Africa)) · “Hey Valo?”
