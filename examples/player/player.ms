// Player Character — a tiny, self-contained platformer demo.
//
//   ← / →   walk
//   space   jump
//   click   the character
//
// Everything starts from the green flag. The ground is painted with the pen,
// so the project needs nothing beyond the two player costumes.

sprite "Player Character" {
    layer: 1;
    costumes: {
        idle: "../../assets/costumes/player_idle.svg",
        running: "../../assets/costumes/player_run.svg"
    };

    let speed = 6;       // pixels moved per frame while walking
    let vy = 0;          // vertical velocity while jumping
    let grounded = true;
    let steps = 0;

    // ---- setup + main loop ---------------------------------------------
    when greenFlag {
        looks.setSize(90);
        motion.setRotationStyle("left-right");
        drawGround();
        motion.goToXY(-160, -80);
        steps = 0;
        control.forever {
            update();
        }
    }

    when keyPressed("space") {
        jump();
    }

    when spriteClicked {
        looks.sayForSecs(mood(), 2);
    }

    // ---- behaviour ------------------------------------------------------
    function update() {
        // Walk, facing the direction of travel.
        if (sensing.keyPressed("right arrow")) {
            motion.changeX(speed);
            motion.pointInDirection(90);
            steps += 1;
        } else if (sensing.keyPressed("left arrow")) {
            motion.changeX(-speed);
            motion.pointInDirection(-90);
            steps += 1;
        }

        // Fall under gravity until we land back on the ground.
        if (not grounded) {
            vy -= 1;
            motion.changeY(vy);
            if (motion.yPosition() < -80) {
                motion.setY(-80);
                vy = 0;
                grounded = true;
            }
        }

        // Keep the character on the stage.
        if (motion.xPosition() > 220) {
            motion.setX(220);
        } else if (motion.xPosition() < -220) {
            motion.setX(-220);
        }

        // Animate: running while a direction is held, idle otherwise.
        if (sensing.keyPressed("right arrow") or sensing.keyPressed("left arrow")) {
            looks.switchCostume("running");
        } else {
            looks.switchCostume("idle");
        }
    }

    function jump() {
        if (grounded) {
            vy = 13;
            grounded = false;
        }
    }

    returning function mood() {
        if (steps > 60) {
            return "I love exploring!";
        }
        return "Let's take a walk.";
    }

    // Paint a simple ground line and leave the pen up again.
    warp function drawGround() {
        pen.clear();
        pen.setSize(24);
        pen.setColor("#7a5230");
        motion.goToXY(-240, -110);
        pen.penDown();
        motion.setX(240);
        pen.penUp();
    }
}
