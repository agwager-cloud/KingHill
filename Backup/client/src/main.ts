import Phaser from "phaser";
import StartScene from "./scenes/StartScene";
import HostLobbyScene from "./scenes/HostLobbyScene";
import GameScene from "./scenes/GameScene";
import "./network/socket";
import "./style.css";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "app",
  backgroundColor: "#1a1a1a",
  scale: {
    mode: Phaser.Scale.RESIZE,
    parent: "app",
    width: "100%",
    height: "100%",
  },
  scene: [StartScene, HostLobbyScene, GameScene],
};

new Phaser.Game(config);
