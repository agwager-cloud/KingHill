import Phaser from "phaser";
import StartScene from "./scenes/StartScene";
import HostLobbyScene from "./scenes/HostLobbyScene";
import GameScene from "./scenes/GameScene";
import "./network/socket";
import "./style.css";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "app",
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#1a1a1a",
  scene: [StartScene, HostLobbyScene, GameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

new Phaser.Game(config);
