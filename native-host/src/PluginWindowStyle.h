#pragma once
#include <juce_gui_basics/juce_gui_basics.h>

class PluginFrameButton final : public juce::Button {
public:
    explicit PluginFrameButton(int type) : Button(type == juce::DocumentWindow::closeButton ? "Close" : "Always on top"), close(type == juce::DocumentWindow::closeButton) {}
    void paintButton(juce::Graphics& g, bool over, bool down) override {
        auto* window = findParentComponentOfClass<juce::DocumentWindow>();
        const bool pinned = !close && window && window->isAlwaysOnTop();
        auto bounds = getLocalBounds().toFloat().reduced(4.0f, 5.0f);
        if (over || pinned) {
            g.setColour(close ? juce::Colour(0xffa83d52) : juce::Colour(pinned ? 0x3039d9e9 : 0x18ffffff));
            g.fillRoundedRectangle(bounds, 5.0f);
        }
        g.setColour(pinned ? juce::Colour(0xff72dce7) : juce::Colour(over ? 0xffeef7fa : 0xffa2b5bc));
        const float x = getWidth() * .5f, y = getHeight() * .5f;
        if (close) {
            g.drawLine(x-3.5f,y-3.5f,x+3.5f,y+3.5f,1.3f);
            g.drawLine(x+3.5f,y-3.5f,x-3.5f,y+3.5f,1.3f);
        } else {
            juce::Path pin;
            pin.startNewSubPath(x-3,y-5); pin.lineTo(x+3,y-5);
            pin.lineTo(x+2,y); pin.lineTo(x+4,y+2);
            pin.lineTo(x-4,y+2); pin.lineTo(x-2,y); pin.closeSubPath();
            g.strokePath(pin,juce::PathStrokeType(1.2f));
            g.drawLine(x,y+2,x,y+6,1.2f);
        }
        if (down) {g.setColour(juce::Colour(0x18000000));g.fillRoundedRectangle(bounds,5);}
    }
private:
    bool close;
};

class PluginWindowLookAndFeel final : public juce::LookAndFeel_V4 {
public:
    PluginWindowLookAndFeel() {setColour(juce::ResizableWindow::backgroundColourId,juce::Colour(0xff101b20));}
    juce::Button* createDocumentWindowButton(int type) override {return new PluginFrameButton(type);}
    void positionDocumentWindowButtons(juce::DocumentWindow&,int x,int y,int w,int h,juce::Button* pin,juce::Button* maximise,juce::Button* close,bool) override {
        const int buttonWidth=36;
        if(close) close->setBounds(x+w-buttonWidth,y,buttonWidth,h);
        if(pin) pin->setBounds(x+w-buttonWidth*2,y,buttonWidth,h);
        if(maximise) maximise->setVisible(false);
    }
    void drawDocumentWindowTitleBar(juce::DocumentWindow& window,juce::Graphics& g,int w,int h,int,int,const juce::Image*,bool active) override {
        g.setGradientFill(juce::ColourGradient(juce::Colour(active?0xff26363d:0xff202c32),0,0,juce::Colour(0xff111c22),0,static_cast<float>(h),false));
        g.fillAll();
        g.setColour(juce::Colour(0x22dceef4));g.drawHorizontalLine(0,0,static_cast<float>(w));
        g.setColour(juce::Colour(0x14000000));g.drawHorizontalLine(h-1,0,static_cast<float>(w));
        g.setColour(juce::Colour(0xff72dce7));g.fillRoundedRectangle(12,h*.5f-4,2,8,1);
        g.setColour(juce::Colour(0xffdce8ed));g.setFont(juce::FontOptions(13.0f));
        g.drawText(window.getName(),22,0,juce::jmax(0,w-100),h,juce::Justification::centredLeft,true);
    }
};

inline void configurePluginPin(juce::DocumentWindow& window) {
    if(auto* button=window.getMinimiseButton()) {
        button->setTooltip("Always on top");

    }
    if(auto* button=window.getCloseButton()) button->setTooltip("Close plugin window");
}
