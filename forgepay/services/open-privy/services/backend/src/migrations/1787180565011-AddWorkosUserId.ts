import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWorkosUserId1787180565011 implements MigrationInterface {
    name = 'AddWorkosUserId1787180565011'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "workosUserId" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_d3e68f8fde8ff77fb3708982df1" UNIQUE ("workosUserId")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_d3e68f8fde8ff77fb3708982df1"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "workosUserId"`);
    }

}
