import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaDiagnosis1793184171990 implements MigrationInterface {
  name = 'AddMediaDiagnosis1793184171990';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "media" ADD "diagnosis" text`);
    await queryRunner.query(`ALTER TABLE "media" ADD "diagnosis4k" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "diagnosis4k"`);
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "diagnosis"`);
  }
}
