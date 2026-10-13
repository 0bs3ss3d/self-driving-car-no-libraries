/*
 * controls.js
 * The four driving inputs (forward, left, right, reverse) and the keyboard
 * binding for the human-driven car. Controls is plain data, so AI cars and the
 * headless simulation use it without touching the DOM.
 */
(function (SDC) {
  "use strict";

  class Controls {
    constructor() {
      this.forward = false;
      this.left = false;
      this.right = false;
      this.reverse = false;
    }

    release() {
      this.forward = false;
      this.left = false;
      this.right = false;
      this.reverse = false;
    }

    // Network outputs arrive in the order forward, left, right, reverse.
    setFromOutputs(outputs) {
      this.forward = outputs[0] > 0.5;
      this.left = outputs[1] > 0.5;
      this.right = outputs[2] > 0.5;
      this.reverse = outputs[3] > 0.5;
    }
  }

  // Physical key codes, so WASD sits in the same place on AZERTY or QWERTZ.
  const KEY_ACTIONS = {
    ArrowUp: "forward",
    KeyW: "forward",
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    ArrowDown: "reverse",
    KeyS: "reverse",
  };

  // True when the element is somewhere the user types text.
  function isTextEntry(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea" || tag === "select") return true;
    if (tag === "input") {
      const type = (el.type || "text").toLowerCase();
      return type !== "range" && type !== "checkbox" && type !== "radio" && type !== "button";
    }
    return el.isContentEditable === true;
  }

  // Keeps a Controls object in sync with the keyboard while `enabled` is true.
  class KeyboardInput {
    constructor() {
      this.controls = new Controls();
      this.enabled = true;
      this.target = null;
      this.onKeyDown = (event) => this.handle(event, true);
      this.onKeyUp = (event) => this.handle(event, false);
      this.onBlur = () => this.controls.release();
    }

    attach(target) {
      this.detach();
      this.target = target;
      target.addEventListener("keydown", this.onKeyDown);
      target.addEventListener("keyup", this.onKeyUp);
      target.addEventListener("blur", this.onBlur);
    }

    detach() {
      if (!this.target) return;
      this.target.removeEventListener("keydown", this.onKeyDown);
      this.target.removeEventListener("keyup", this.onKeyUp);
      this.target.removeEventListener("blur", this.onBlur);
      this.target = null;
    }

    handle(event, pressed) {
      const action = KEY_ACTIONS[event.code];
      if (!action) return;
      if (!pressed) {
        this.controls[action] = false; // releases always count
        return;
      }
      if (!this.enabled || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTextEntry(event.target)) return;
      this.controls[action] = true;
      event.preventDefault(); // stop arrows from scrolling or nudging sliders
    }
  }

  SDC.Controls = Controls;
  SDC.KeyboardInput = KeyboardInput;
  SDC.isTextEntry = isTextEntry;
})((window.SDC = window.SDC || {}));
