import unittest

from onepm.constants import REDACTED
from onepm.masking import mask_secrets


class MaskSecretsTest(unittest.TestCase):
    def test_masks_known_token_shapes(self):
        samples = [
            "ghp_" + "a1" * 15,
            "github_pat_" + "B2_" * 10,
            "sk-ant-" + "x9" * 15,
            "opm_" + "k" * 20,
            "xoxb-1234567890-abcdef",
            "AKIAABCDEFGHIJKLMNOP",
            "eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4",
        ]
        for secret in samples:
            with self.subTest(secret=secret):
                masked = mask_secrets(f"token is {secret} ok")
                self.assertNotIn(secret, masked)
                self.assertEqual(masked, f"token is {REDACTED} ok")

    def test_keeps_the_scheme_word_and_url_user(self):
        self.assertEqual(mask_secrets("Authorization: Bearer abcdefghijklmnop"),
                         f"Authorization: Bearer {REDACTED}")
        self.assertEqual(mask_secrets("db at postgres://dev:hunter2pw@db:5432/app"),
                         f"db at postgres://dev:{REDACTED}@db:5432/app")

    def test_masks_known_values_first(self):
        self.assertEqual(mask_secrets("key=plainkey123 here", ["plainkey123"]), f"key={REDACTED} here")

    def test_ignores_short_known_values(self):
        self.assertEqual(mask_secrets("a b c", ["a", ""]), "a b c")

    def test_leaves_ordinary_text_alone(self):
        text = "Fixed ONEPM-12: the board now loads 40% faster. See https://example.com/docs."
        self.assertEqual(mask_secrets(text), text)


if __name__ == "__main__":
    unittest.main()
