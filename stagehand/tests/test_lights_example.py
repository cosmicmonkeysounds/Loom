from pathlib import Path

from stagehand.config import load_config

ROOT = Path(__file__).resolve().parents[1]


def test_the_lights_example_loads_with_its_defaults():
    lights = load_config(ROOT / "lights.example.yaml").modules["lights"]
    cfg = lights.cfg
    assert (cfg.mqtt.host, cfg.mqtt.port, cfg.mqtt.client_id) == ("127.0.0.1", 1883, "stagehand-lights")
    assert cfg.z2m_base == "zigbee2mqtt" and cfg.take_looks and cfg.config_file is None
    assert cfg.poll_wait == 25 and cfg.health_s == 15
    assert any(line.startswith("mqtt") for line in lights.describe())
