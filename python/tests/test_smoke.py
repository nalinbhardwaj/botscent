import json
import pathlib

import botscent


def test_version_is_the_package_version():
    package = json.loads((pathlib.Path(__file__).parents[2] / "package.json").read_text())
    assert botscent.VERSION == package["version"]
