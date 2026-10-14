// MeowScript "all blocks" showcase.
//
// Every built-in catalog block (all 116), plus the variable/list blocks that
// the language emits directly and the custom-procedure forms, so that
// `ms build examples/all-blocks` compiles the whole surface of the compiler.
//
// Blocks that return a value are consumed where a value is expected (usually
// `looks.say(...)` or an `if (...)` condition); command blocks are called as
// statements. Terminal blocks (`return`, `control.stop`, `control.deleteThisClone`)
// are deliberately the last statement of their stack — the editor gives them no
// next-statement connection.

stage {
    // ---- global (stage-scoped) state ------------------------------------
    let globalCounter = 0;
    cloud let globalCloud = 0;
    list globalItems = ["a", "b", "c"];

    when greenFlag {
        // backdrop blocks live on the Stage
        looks.switchBackdrop("backdrop1");
        looks.switchBackdropAndWait("backdrop1");
        looks.nextBackdrop();
        looks.say(looks.backdropNumber("number"));

        // variable + list data blocks
        globalCounter = 0;
        globalCounter += 1;
        globalCloud = 1;
        globalItems.push("d");
        globalItems.insert(1, "z");
        globalItems.replace(2, "y");
        globalItems.deleteAt(1);
        globalItems.show();
        globalItems.hide();
        looks.say(globalItems.itemAt(1));
        looks.say(globalItems.itemNumber("b"));
        looks.say(globalItems.length());
        if (globalItems.contains("b")) {
            looks.say("found");
        }
        globalItems.deleteAll();
    }

    // ---- every hat event on the Stage -----------------------------------
    when stageClicked {
        looks.nextBackdrop();
    }
    when backdropSwitchesTo("backdrop1") {
        looks.switchBackdrop("backdrop1");
    }
    when broadcast("stage ping") {
        looks.nextBackdrop();
    }
    when loudnessGreaterThan(10) {
    }
    when timerGreaterThan(10) {
    }
    when keyPressed("space") {
    }
}

sprite "AllBlocks" {
    layer: 1;
    costumes: { idle: "../../../assets/costumes/player_idle.svg" };

    let score = 0;
    let flag = false;
    list items = ["a", "b", "c"];

    // ---- custom procedure forms -----------------------------------------
    function noop() {
        looks.show();
    }
    function bump(amount: number, loud: boolean) {
        score += amount;
        if (loud) {
            looks.say("bump");
        }
    }
    returning function label() {
        if (score > 10) {
            return "Pro";
        }
        return "Rookie";
    }
    warp function fastNoop() {
        motion.changeX(1);
    }

    when greenFlag {
        // ---- motion (18) ------------------------------------------------
        motion.moveSteps(10);
        motion.turnRight(15);
        motion.turnLeft(15);
        motion.goToXY(0, 0);
        motion.goTo("_mouse_");
        motion.glideToXY(1, 50, 50);
        motion.glideTo(1, "_mouse_");
        motion.pointInDirection(90);
        motion.pointTowards("_mouse_");
        motion.changeX(10);
        motion.setX(0);
        motion.changeY(10);
        motion.setY(0);
        motion.ifOnEdgeBounce();
        motion.setRotationStyle("all around");
        looks.say(motion.xPosition());
        looks.say(motion.yPosition());
        looks.say(motion.direction());

        // ---- looks (21) -------------------------------------------------
        looks.say("hello");
        looks.sayForSecs("hello", 1);
        looks.think("hmm");
        looks.thinkForSecs("hmm", 1);
        looks.switchCostume("idle");
        looks.nextCostume();
        looks.changeSize(10);
        looks.setSize(100);
        looks.changeEffect("color", 25);
        looks.setEffect("ghost", 25);
        looks.clearEffects();
        looks.show();
        looks.hide();
        looks.goToFrontLayer("front");
        looks.goLayers("forward", 1);
        looks.say(looks.costumeNumber("number"));
        looks.say(looks.size());

        // ---- sound (9) --------------------------------------------------
        sound.play("pop");
        sound.playUntilDone("pop");
        sound.stopAllSounds();
        sound.changeEffect("pitch", 10);
        sound.setEffect("pitch", 10);
        sound.clearEffects();
        sound.changeVolume(-10);
        sound.setVolume(100);
        looks.say(sound.volume());

        // ---- sensing (17) -----------------------------------------------
        if (sensing.touching("_mouse_")) {
        }
        if (sensing.touchingColor("#ff0000")) {
        }
        if (sensing.colorIsTouchingColor("#ff0000", "#0000ff")) {
        }
        looks.say(sensing.distanceTo("_mouse_"));
        sensing.askAndWait("What is your name?");
        looks.say(sensing.answer());
        if (sensing.keyPressed("space")) {
        }
        if (sensing.mouseDown()) {
        }
        looks.say(sensing.mouseX());
        looks.say(sensing.mouseY());
        looks.say(sensing.loudness());
        looks.say(sensing.timer());
        sensing.resetTimer();
        looks.say(sensing.propertyOf("x position", "_stage_"));
        looks.say(sensing.current("year"));
        looks.say(sensing.daysSince2000());
        looks.say(sensing.username());

        // ---- operators (18) ---------------------------------------------
        looks.say(operators.add(1, 2));
        looks.say(operators.subtract(2, 1));
        looks.say(operators.multiply(2, 3));
        looks.say(operators.divide(6, 2));
        looks.say(operators.random(1, 6));
        if (operators.gt(2, 1)) {
        }
        if (operators.lt(1, 2)) {
        }
        if (operators.equals(1, 1)) {
        }
        if (operators.and(true, false)) {
        }
        if (operators.or(false, true)) {
        }
        if (operators.not(false)) {
        }
        looks.say(operators.join("a", "b"));
        looks.say(operators.letterOf(1, "abc"));
        looks.say(operators.length("abc"));
        if (operators.contains("abc", "b")) {
        }
        looks.say(operators.mod(5, 2));
        looks.say(operators.round(1.5));
        looks.say(operators.math("sqrt", 9));

        // ---- control (10) -----------------------------------------------
        control.wait(1);
        control.repeat(10) {
            looks.show();
        }
        control.if(true) {
            looks.show();
        }
        control.ifElse(false) {
            looks.show();
        } else {
            looks.hide();
        }
        control.waitUntil(false);
        control.repeatUntil(false) {
            looks.show();
        }
        control.stop("other scripts in sprite");
        control.clone("_myself_");

        // ---- events (2) -------------------------------------------------
        events.broadcast("scene ping");
        events.broadcastAndWait("scene ping");

        // ---- pen (9) ----------------------------------------------------
        pen.clear();
        pen.stamp();
        pen.penDown();
        pen.penUp();
        pen.setColor("#ff8800");
        pen.changeSize(1);
        pen.setSize(3);
        pen.changeColorParam("color", 10);
        pen.setColorParam("color", 50);

        // ---- penguinmod (3) ---------------------------------------------
        looks.say(pm.lastKeyPressed());
        if (pm.isCompiled()) {
        }
        if (pm.isPenguinMod()) {
        }

        // ---- data blocks -------------------------------------------------
        score = 0;
        score += 1;
        score -= 1;
        score *= 2;
        score /= 2;
        flag = true;
        items.push("d");
        items.insert(2, "e");
        items.replace(1, "f");
        items.deleteAt(3);
        items.show();
        items.hide();
        looks.say(items.itemAt(1));
        looks.say(items.itemNumber("f"));
        looks.say(items.length());
        if (items.contains("f")) {
        }
        items.deleteAll();

        // ---- custom procedures ------------------------------------------
        noop();
        bump(2, true);
        fastNoop();
        looks.say(label());

        // ---- infix expressions & precedence -----------------------------
        looks.say(1 + 2 * 3 - 4 / 2 % 3);
        if ((score > 0) and (score < 100)) {
        }
        if ((score == 0) or (score != 1)) {
        }
        if (not (score < 0)) {
        }

        // `control.forever` is dynamic: PenguinMod only gives it a
        // next-statement nub once a block sits below it. The
        // `when keyPressed("z")` hat below exercises that `hasbreak` mutation.
        control.forever {
            motion.turnRight(1);
        }
    }

    // ---- the remaining hat events on a sprite ---------------------------
    when keyPressed("a") {
        score += 1;
    }
    when spriteClicked {
        looks.say("clicked");
    }
    when cloneStart {
        control.deleteThisClone();
    }
    when broadcast("scene ping") {
        looks.show();
    }

    // Exercises PenguinMod's loop nub: a forever loop with a block stacked
    // below it needs the `hasbreak` mutation to survive an editor round-trip.
    when keyPressed("z") {
        control.forever {
            looks.show();
        }
        looks.hide();
    }

    // Terminal stop variants (each must be the last statement of its stack).
    when keyPressed("q") {
        control.stop("all");
    }
    when keyPressed("w") {
        control.stop("this script");
    }
}
