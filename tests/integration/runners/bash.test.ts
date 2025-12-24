import { describe, it } from 'vitest';
import {BashRunner} from "../../../src/runners/bash";


describe('BashRunner', () => {

    it('should run a bash script', async () => {

        const runner = new BashRunner('', {
            type: 'bash',
            category: 'default',
            command: 'ls -alh'
        });

        runner.on('stdout', console.log)
        runner.on('stderr', console.error)

        await runner.start();
        await wait(1000);
        await runner.stop();

    });


});

function wait(ms: number ){
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}