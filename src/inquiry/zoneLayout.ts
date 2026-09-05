export type InquiryZoneId = 'setup' | 'pressure' | 'payoff';

export interface InquiryZoneLayout {
    x: number;
    y: number;
    axisRotationDeg: number;
    numberRadius: number;
    numberStartAngleDeg: number;
    numberDirection: 'ccw' | 'cw';
}

export const ZONE_LAYOUT: Record<InquiryZoneId, InquiryZoneLayout> = {
    setup: {
        x: -150,
        y: -85.5,
        axisRotationDeg: 3, // bigger rotates CW
        numberRadius: 225,
        numberStartAngleDeg: 250, //bigger moves CW
        numberDirection: 'ccw'
    },
    pressure: {
        x: 145.5,
        y: -90.5,
        axisRotationDeg: 123,
        numberRadius: 225,
        numberStartAngleDeg: 290, //bigger moves CW
        numberDirection: 'cw'
    },
    payoff: {
        x: 0,
        y: 173,
        axisRotationDeg: 243,
        numberRadius: 225,
        numberStartAngleDeg: 50, //bigger moves CW
        numberDirection: 'cw'
    }
};
