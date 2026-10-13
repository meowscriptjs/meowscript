// Painter — a rainbow sketchpad that follows your mouse.
//
//   move the mouse   draw
//   space            start a blank canvas
//
// The cat chases the pointer while the pen leaves a rainbow trail behind it.

sprite "Painter" {
    layer: 1;
    costumes: { cat: "../../assets/costumes/player_idle.svg" };

    let hue = 0;

    when greenFlag {
        looks.setSize(60);
        motion.setRotationStyle("don't rotate");
        motion.goToXY(sensing.mouseX(), sensing.mouseY());
        pen.clear();
        pen.setSize(8);
        pen.penDown();
        control.forever {
            followMouse();
        }
    }

    when keyPressed("space") {
        pen.clear();
        hue = 0;
    }

    // Step the pen colour through the spectrum, then chase the pointer.
    function followMouse() {
        hue += 2;
        if (hue > 100) {
            hue = 0;
        }
        pen.setColorParam("color", hue);
        motion.goToXY(sensing.mouseX(), sensing.mouseY());
    }
}
