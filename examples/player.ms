// MeowScript syntax fixture — mirrors the language reference in the spec.
sprite "Player Character" {
    layer: 2;

    costumes: {
        idle: "../assets/costumes/player_idle.svg",
        running: "../assets/costumes/player_run.svg"
    };

    let health = 100;
    let speed = 5;

    when greenFlag {
        looks.switchCostume("idle");
        motion.goToXY(0, -100);

        control.forever {
            if (sensing.keyPressed("right arrow")) {
                motion.changeX(speed);
                motion.pointInDirection(90);
            }
            if (sensing.keyPressed("left arrow")) {
                motion.changeX(-speed);
                motion.pointInDirection(-90);
            }
        }
    }

    when keyPressed("space") {
        jump();
    }

    // Standard command function
    function jump() {
        if (sensing.touchingColor("#000000")) {
            motion.changeY(40);
            control.wait(0.1);
            motion.changeY(-40);
            sound.play("JumpSound");
            pen.stamp();
        }
    }

    // Custom reporter function using 'returning function'
    returning function getHealthStatus() {
        if (health > 50) {
            return "Healthy";
        } else {
            return "Danger";
        }
    }
}
